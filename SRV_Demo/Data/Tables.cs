namespace SRV_Demo.Data;

public enum ColType { Uuid, Str, Text, Int, Long, Dec, Bool, Ts, Date, Json, Char }

/// <summary>How a table's bookkeeping columns are maintained (replaces the PostgreSQL triggers of the Supabase version).</summary>
public enum Stamp
{
    None,
    /// <summary>created_at/updated_at/created_by/updated_by/version; updates are optimistic-locked on <c>version</c>.</summary>
    Versioned,
    /// <summary>created_at + created_by (task_links, recurrence_exceptions).</summary>
    CreatedBy,
    /// <summary>created_at + author_id (task_updates).</summary>
    Author,
    /// <summary>created_at + chosen_by (weekly_priorities).</summary>
    Chooser,
    /// <summary>updated_at + updated_by (settings).</summary>
    Updated,
    /// <summary>updated_at only (profiles).</summary>
    Touch,
}

public sealed class Col
{
    public required string Name { get; init; }
    public ColType Type { get; init; }
    public bool Nullable { get; init; } = true;
    /// <summary>Accepted from the client. Server-managed columns (id, stamps, completed_at …) are not writable.</summary>
    public bool Writable { get; init; } = true;
    public bool NonBlank { get; init; }
    public int MaxLength { get; init; }
    public decimal? Min { get; init; }
    public decimal? Max { get; init; }
    public string[]? Values { get; init; }
    public object? Default { get; init; }
    /// <summary>Must start with http:// or https://.</summary>
    public bool HttpUrl { get; init; }
    public string? Label { get; init; }
}

public sealed class TableDef
{
    public required string Name { get; init; }
    public required Col[] Cols { get; init; }
    public Stamp Stamp { get; init; } = Stamp.None;
    public bool Audited { get; init; } = true;
    public string IdColumn { get; init; } = "id";
    /// <summary>Domain rules; throws <see cref="Common.ApiException"/>. <c>old</c> is null on insert.</summary>
    public Action<Row, Row?, DateTime>? Rules { get; init; }

    private Dictionary<string, Col>? _byName;
    /// <summary>Column by name, or null for ad-hoc selects (aliases, columns outside the snapshot such as last_login_at).</summary>
    public Col? Find(string name) => (_byName ??= Cols.ToDictionary(c => c.Name)).GetValueOrDefault(name);
    public Col Get(string name) => Find(name) ?? throw new KeyNotFoundException($"{Name}.{name}");
    public string ColumnList => string.Join(", ", Cols.Select(c => $"`{c.Name}`"));
    public string Select => $"SELECT {ColumnList} FROM `{Name}`";
}

/// <summary>Table metadata. Keep in sync with Data/Migrations/*.sql (see docs/DATABASE.md).</summary>
public static class Tables
{
    private static readonly string[] CategoryCodes = ["A", "B", "C", "D", "E", "F"];

    // ---- column helpers -------------------------------------------------------------------------------------
    private static Col Id(string name = "id") => new() { Name = name, Type = ColType.Uuid, Nullable = false, Writable = false };
    private static Col Ref(string name, bool required = false) => new() { Name = name, Type = ColType.Uuid, Nullable = !required };
    private static Col Sys(string name, ColType t = ColType.Ts, bool nullable = true) => new() { Name = name, Type = t, Nullable = nullable, Writable = false };
    private static Col Str(string name, int max, bool nonBlank = false, bool required = false, string[]? values = null, object? def = null, string? label = null)
        => new() { Name = name, Type = ColType.Str, MaxLength = max, NonBlank = nonBlank, Nullable = !required && def is null, Values = values, Default = def, Label = label };
    private static Col Text(string name, bool nonBlank = false, bool required = false, string? label = null)
        => new() { Name = name, Type = ColType.Text, MaxLength = 20000, NonBlank = nonBlank, Nullable = !required, Label = label };
    private static Col Int(string name, decimal? min = null, decimal? max = null, bool required = false, object? def = null)
        => new() { Name = name, Type = ColType.Int, Min = min, Max = max, Nullable = !required, Default = def };
    private static Col Dec(string name, decimal min, decimal max, object? def = null)
        => new() { Name = name, Type = ColType.Dec, Min = min, Max = max, Nullable = false, Default = def };
    private static Col Bool(string name, bool def = false) => new() { Name = name, Type = ColType.Bool, Nullable = false, Default = def };
    private static Col Ts(string name, bool required = false) => new() { Name = name, Type = ColType.Ts, Nullable = !required };
    private static Col Date(string name, bool required = false) => new() { Name = name, Type = ColType.Date, Nullable = !required };
    private static Col Category(string name = "category_code") => new() { Name = name, Type = ColType.Char, Values = CategoryCodes };

    private static Col[] Stamps => [Sys("created_at", nullable: false), Sys("updated_at", nullable: false),
        Sys("created_by", ColType.Uuid), Sys("updated_by", ColType.Uuid), Sys("version", ColType.Int, nullable: false)];

    // ---- tables ---------------------------------------------------------------------------------------------
    /// <summary>password_hash is deliberately absent so it can never leak into JSON or audit snapshots.</summary>
    public static readonly TableDef Profiles = new()
    {
        Name = "profiles", Stamp = Stamp.Touch,
        Cols =
        [
            Id(), Sys("email", ColType.Str, nullable: false),
            new Col { Name = "display_name", Type = ColType.Str, MaxLength = 120, NonBlank = true, Nullable = false, Label = "Tên hiển thị" },
            Sys("role", ColType.Str, nullable: false),
            new Col { Name = "active", Type = ColType.Bool, Nullable = false, Writable = false },
            Sys("created_at", nullable: false), Sys("updated_at", nullable: false),
        ],
    };

    public static readonly TableDef Categories = new()
    {
        Name = "categories", IdColumn = "code", Audited = false,
        Cols = [Sys("code", ColType.Char, false), Sys("name", ColType.Str, false), Sys("color", ColType.Str, false)],
    };

    public static readonly TableDef People = new()
    {
        Name = "people", Stamp = Stamp.Versioned,
        Cols =
        [
            Id(), Str("full_name", 200, nonBlank: true, required: true, label: "Họ tên"), Str("department", 200), Str("position", 200),
            Text("contact_note"), Bool("active", true), .. Stamps,
        ],
    };

    public static readonly TableDef Goals = new()
    {
        Name = "goals", Stamp = Stamp.Versioned,
        Cols =
        [
            Id(), Str("title", 500, nonBlank: true, required: true, label: "Tiêu đề"), Text("description"), Category(),
            Str("period_type", 16, values: ["quarter", "month", "week"], def: "month"),
            Date("start_date"), Date("due_date"), Dec("progress", 0, 100, 0m),
            Str("status", 16, values: ["active", "achieved", "missed", "paused", "cancelled"], def: "active"),
            Str("source", 16, values: ["user", "demo"], def: "user"), .. Stamps,
        ],
    };

    public static readonly TableDef Tasks = new()
    {
        Name = "tasks", Stamp = Stamp.Versioned, Rules = TaskRules,
        Cols =
        [
            Id(), Str("title", 500, nonBlank: true, required: true, label: "Tiêu đề"), Text("description"), Category(),
            Str("task_type", 16, values: ["self", "delegated"], def: "self"),
            Str("priority", 16, values: ["urgent", "high", "normal", "low"], def: "normal"),
            Str("status", 16, values: ["todo", "doing", "waiting", "paused", "done", "cancelled"], def: "todo"),
            Bool("needs_decision"), Ts("due_at"), Ts("next_follow_up_at"), Int("estimated_minutes", 5, 6000),
            Text("next_action"), Text("expected_result"), Text("completion_result"), Sys("completed_at"),
            Ref("assignee_profile_id"), Ref("assignee_person_id"), Ref("watcher_profile_id"), Ref("goal_id"),
            Str("source", 16, values: ["user", "quick_capture", "demo"], def: "user"), Text("notes"), .. Stamps,
        ],
    };

    public static readonly TableDef TaskUpdates = new()
    {
        Name = "task_updates", Stamp = Stamp.Author,
        Cols =
        [
            Id(), Ref("task_id", required: true), Text("note", nonBlank: true, required: true, label: "Nội dung"),
            Int("progress_percent", 0, 100),
            Str("channel", 16, values: ["zalo", "phone", "email", "in_person", "other"]),
            Ts("next_follow_up_at"), Sys("author_id", ColType.Uuid), Sys("created_at", nullable: false),
        ],
    };

    public static readonly TableDef TaskLinks = new()
    {
        Name = "task_links", Stamp = Stamp.CreatedBy,
        Cols =
        [
            Id(), Ref("task_id", required: true), Str("label", 300),
            new Col { Name = "url", Type = ColType.Str, MaxLength = 2000, Nullable = false, NonBlank = true, HttpUrl = true, Label = "Đường dẫn" },
            Sys("created_at", nullable: false), Sys("created_by", ColType.Uuid),
        ],
    };

    public static readonly TableDef CalendarEvents = new()
    {
        Name = "calendar_events", Stamp = Stamp.Versioned, Rules = EventRules,
        Cols =
        [
            Id(), Str("title", 500, nonBlank: true, required: true, label: "Tiêu đề"),
            Ts("start_at", required: true), Ts("end_at", required: true),
            Str("event_type", 16, values: ["fixed", "focus", "flexible", "urgent", "buffer"], def: "flexible"),
            Category(), Ref("task_id"), Bool("locked"), Str("recurrence_rule", 500), Ref("recurrence_parent_id"),
            Str("timezone", 64, def: "Asia/Ho_Chi_Minh"),
            Str("status", 16, values: ["confirmed", "tentative", "cancelled", "done"], def: "confirmed"),
            Text("notes"), Str("source", 16, values: ["user", "scheduler", "demo"], def: "user"), .. Stamps,
        ],
    };

    public static readonly TableDef RecurrenceExceptions = new()
    {
        Name = "recurrence_exceptions", Stamp = Stamp.CreatedBy,
        Cols =
        [
            Id(), Ref("parent_event_id", required: true), Ts("occurrence_start_at", required: true),
            Str("action", 16, required: true, values: ["skip", "replace"]), Ref("replacement_event_id"),
            Sys("created_at", nullable: false), Sys("created_by", ColType.Uuid),
        ],
    };

    public static readonly TableDef WeeklyPriorities = new()
    {
        Name = "weekly_priorities", Stamp = Stamp.Chooser,
        Cols =
        [
            Id(), Date("week_start", required: true), Ref("task_id", required: true), Int("rank", 1, 3, required: true),
            Sys("chosen_by", ColType.Uuid), Sys("created_at", nullable: false),
        ],
    };

    public static readonly TableDef Notifications = new()
    {
        Name = "notifications", Audited = false,
        Cols =
        [
            Id(), Sys("target_profile_id", ColType.Uuid, false), Sys("kind", ColType.Str, false), Sys("entity_type", ColType.Str, false),
            Sys("entity_id", ColType.Uuid, false), Sys("scheduled_at", nullable: false), Sys("read_at"), Sys("resolved_at"),
            Sys("dedupe_key", ColType.Str, false), Sys("created_at", nullable: false),
        ],
    };

    public static readonly TableDef AuditLogs = new()
    {
        Name = "audit_logs", Audited = false,
        Cols =
        [
            Sys("id", ColType.Long, false), Sys("table_name", ColType.Str, false), Sys("record_id", ColType.Uuid),
            Sys("action", ColType.Str, false), Sys("before_data", ColType.Json), Sys("after_data", ColType.Json),
            Sys("actor_id", ColType.Uuid), Sys("created_at", nullable: false),
        ],
    };

    public static readonly TableDef Settings = new()
    {
        Name = "settings", IdColumn = "key", Stamp = Stamp.Updated,
        Cols =
        [
            Sys("key", ColType.Str, false), new Col { Name = "value", Type = ColType.Json, Nullable = false },
            Sys("updated_at", nullable: false), Sys("updated_by", ColType.Uuid),
        ],
    };

    /// <summary>Tables written to audit_logs (same list as tg_audit in the PostgreSQL version).</summary>
    public static readonly TableDef[] All =
        [Profiles, Categories, People, Goals, Tasks, TaskUpdates, TaskLinks, CalendarEvents, RecurrenceExceptions,
         WeeklyPriorities, Notifications, AuditLogs, Settings];

    // ---- domain rules ---------------------------------------------------------------------------------------
    private static void TaskRules(Row r, Row? old, DateTime now)
    {
        var status = r["status"] as string;
        var hasProfile = r["assignee_profile_id"] is not null;
        var hasPerson = r["assignee_person_id"] is not null;
        if (hasProfile && hasPerson)
            throw Common.ApiException.Validation("Chỉ chọn một người thực hiện.", "tasks_one_assignee");

        if (status == "done")
        {
            if (string.IsNullOrWhiteSpace(r["completion_result"] as string))
                throw Common.ApiException.Validation("Cần ghi kết quả trước khi đánh dấu Hoàn thành.", "tasks_done_requires_result");
            // set when the task enters 'done'; kept (old value is carried in the row) while it stays 'done'
            r["completed_at"] ??= Fmt.Iso(now);
        }
        else
        {
            r["completed_at"] = null;
        }
    }

    private static void EventRules(Row r, Row? old, DateTime now)
    {
        if (r["start_at"] is string s && r["end_at"] is string e &&
            DateTime.Parse(e, null, System.Globalization.DateTimeStyles.RoundtripKind) <=
            DateTime.Parse(s, null, System.Globalization.DateTimeStyles.RoundtripKind))
            throw Common.ApiException.Validation("Giờ kết thúc phải sau giờ bắt đầu.", "event_time_invalid");
    }
}
