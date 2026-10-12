using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using SRV_Demo.Common;

namespace SRV_Demo.Data;

/// <summary>
/// Generic, metadata-driven CRUD with the behaviour the PostgreSQL triggers/RLS gave the Supabase version:
/// created_by/updated_by/version stamping, optimistic locking (409 version_conflict), domain rules,
/// an audit trail in the same transaction and realtime change events.
/// Rows are kept in "JSON form" (ISO-8601 UTC strings for timestamps, bool, numbers, JsonElement for JSON columns).
/// </summary>
public static class Repo
{
    private static readonly JsonSerializerOptions AuditJson = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static bool IsUuid(string? s) => s is not null && Guid.TryParseExact(s, "D", out _);

    // ---- reads --------------------------------------------------------------------------------------------
    public static async Task<Row?> GetAsync(Tx tx, TableDef t, string id, bool forUpdate = false)
    {
        var rows = await tx.QueryAsync($"{t.Select} WHERE `{t.IdColumn}` = @id{(forUpdate ? " FOR UPDATE" : "")}", t, ("@id", id));
        return rows.FirstOrDefault();
    }

    // ---- insert -------------------------------------------------------------------------------------------
    public static async Task<Row> InsertAsync(Tx tx, TableDef t, JsonElement body, string? actor, Row? forced = null)
    {
        var row = new Row();
        foreach (var c in t.Cols)
        {
            if (c.Writable && TryProp(body, c.Name, out var v) && forced?.ContainsKey(c.Name) != true)
            {
                var val = Coerce(c, v);
                row[c.Name] = val ?? (c.Nullable ? null : c.Default);
            }
            else row[c.Name] = c.Default;
        }
        if (forced is not null) foreach (var (k, v) in forced) row[k] = v;
        if (t.IdColumn == "id") row["id"] = Guid.NewGuid().ToString("D");

        var now = Fmt.Iso(tx.Now);
        switch (t.Stamp)
        {
            case Stamp.Versioned:
                row["created_at"] = row["updated_at"] = now;
                row["created_by"] = row["updated_by"] = actor;
                row["version"] = 1;
                break;
            case Stamp.CreatedBy: row["created_at"] = now; row["created_by"] = actor; break;
            case Stamp.Author: row["created_at"] = now; row["author_id"] = actor; break;
            case Stamp.Chooser: row["created_at"] = now; row["chosen_by"] = actor; break;
            case Stamp.Updated: row["updated_at"] = now; row["updated_by"] = actor; break;
        }

        t.Rules?.Invoke(row, null, tx.Now);
        Validate(t, row);

        var cols = t.Cols.Where(c => row.ContainsKey(c.Name)).ToArray();
        var sql = $"INSERT INTO `{t.Name}` ({string.Join(",", cols.Select(c => $"`{c.Name}`"))}) " +
                  $"VALUES ({string.Join(",", cols.Select((_, i) => "@p" + i))})";
        await tx.ExecAsync(sql, cols.Select((c, i) => ("@p" + i, ToDb(c, row[c.Name]))).ToArray());

        var saved = await GetAsync(tx, t, (string)row[t.IdColumn]!) ?? throw new InvalidOperationException("Row vanished after insert");
        await AuditAsync(tx, t, "INSERT", null, saved, actor);
        tx.Events.Add(new ChangeEvent(t.Name, "INSERT", saved));
        return saved;
    }

    // ---- update -------------------------------------------------------------------------------------------
    /// <param name="requireVersion">Versioned tables must be updated with the version the client last saw.</param>
    public static async Task<Row> UpdateAsync(Tx tx, TableDef t, string id, JsonElement body, string? actor,
        bool requireVersion = true, Row? forced = null)
    {
        var old = await GetAsync(tx, t, id, forUpdate: true) ?? throw ApiException.NotFound();
        var versioned = t.Stamp == Stamp.Versioned;

        if (versioned)
        {
            long? sent = null;
            if (TryProp(body, "version", out var vEl) && vEl.ValueKind == JsonValueKind.Number && vEl.TryGetInt64(out var vv)) sent = vv;
            if (sent is null && requireVersion) throw ApiException.BadRequest("Thiếu số phiên bản (version) của bản ghi.");
            if (sent is not null && sent != Convert.ToInt64(old["version"]))
                throw ApiException.Conflict("Người kia vừa cập nhật bản ghi này. Hãy tải lại để xem thay đổi mới nhất rồi sửa tiếp.");
        }

        var row = new Row(old);
        foreach (var c in t.Cols)
            if (c.Writable && TryProp(body, c.Name, out var v) && forced?.ContainsKey(c.Name) != true)
                row[c.Name] = Coerce(c, v);
        if (forced is not null) foreach (var (k, v) in forced) row[k] = v;

        t.Rules?.Invoke(row, old, tx.Now);
        Validate(t, row);

        var changed = t.Cols
            .Where(c => c.Name != t.IdColumn && !IsStamp(c.Name) && Canon(old[c.Name]) != Canon(row[c.Name]))
            .ToList();
        if (changed.Count == 0) return old; // nothing really changed: no version bump, no audit (same as tg_audit's no-op skip)

        var now = tx.Now;
        var args = new List<(string, object?)>();
        var setSql = new List<string>();
        foreach (var c in changed)
        {
            setSql.Add($"`{c.Name}` = @v_{c.Name}");
            args.Add(($"@v_{c.Name}", ToDb(c, row[c.Name])));
        }
        if (t.Stamp is Stamp.Versioned or Stamp.Updated)
        {
            setSql.Add("`updated_at` = @v_updated_at"); args.Add(("@v_updated_at", now));
            setSql.Add("`updated_by` = @v_updated_by"); args.Add(("@v_updated_by", actor));
        }
        else if (t.Stamp == Stamp.Touch)
        {
            setSql.Add("`updated_at` = @v_updated_at"); args.Add(("@v_updated_at", now));
        }
        else if (t.Stamp == Stamp.Chooser)
        {
            setSql.Add("`chosen_by` = @v_chosen_by"); args.Add(("@v_chosen_by", actor));
        }
        var where = $"`{t.IdColumn}` = @id";
        args.Add(("@id", id));
        if (versioned)
        {
            setSql.Add("`version` = `version` + 1");
            where += " AND `version` = @old_version";
            args.Add(("@old_version", Convert.ToInt64(old["version"])));
        }

        var n = await tx.ExecAsync($"UPDATE `{t.Name}` SET {string.Join(", ", setSql)} WHERE {where}", args.ToArray());
        if (n == 0) throw ApiException.Conflict("Người kia vừa cập nhật bản ghi này. Hãy tải lại để xem thay đổi mới nhất rồi sửa tiếp.");

        var saved = await GetAsync(tx, t, id) ?? throw new InvalidOperationException("Row vanished after update");
        await AuditAsync(tx, t, "UPDATE", old, saved, actor);
        tx.Events.Add(new ChangeEvent(t.Name, "UPDATE", saved));
        return saved;
    }

    // ---- delete -------------------------------------------------------------------------------------------
    public static async Task DeleteAsync(Tx tx, TableDef t, string id, string? actor)
    {
        var old = await GetAsync(tx, t, id, forUpdate: true) ?? throw ApiException.NotFound();
        await tx.ExecAsync($"DELETE FROM `{t.Name}` WHERE `{t.IdColumn}` = @id", ("@id", id));
        await AuditAsync(tx, t, "DELETE", old, null, actor);
        tx.Events.Add(new ChangeEvent(t.Name, "DELETE", old));
    }

    // ---- audit --------------------------------------------------------------------------------------------
    public static async Task AuditAsync(Tx tx, TableDef t, string action, Row? before, Row? after, string? actor)
    {
        if (!t.Audited) return;
        var snapshot = after ?? before;
        string? recordId = t.IdColumn == "id" && snapshot?["id"] is string s && IsUuid(s) ? s : null;
        await tx.ExecAsync(
            "INSERT INTO `audit_logs` (`table_name`,`record_id`,`action`,`before_data`,`after_data`,`actor_id`,`created_at`) " +
            "VALUES (@t,@r,@a,@b,@f,@u,@c)",
            ("@t", t.Name), ("@r", recordId), ("@a", action),
            ("@b", before is null ? null : JsonSerializer.Serialize(before, AuditJson)),
            ("@f", after is null ? null : JsonSerializer.Serialize(after, AuditJson)),
            ("@u", actor), ("@c", tx.Now));
    }

    // ---- helpers ------------------------------------------------------------------------------------------
    private static bool IsStamp(string name) => name is "created_at" or "updated_at" or "created_by" or "updated_by"
        or "version" or "author_id" or "chosen_by";

    /// <summary>JsonElement.GetString() throws on invalid UTF-8; surface that as a 400 instead of a 500.</summary>
    private static string? GetString(JsonElement v)
    {
        try { return v.GetString(); }
        catch (InvalidOperationException) { throw ApiException.BadRequest("Dữ liệu không phải UTF-8 hợp lệ."); }
    }

    private static bool TryProp(JsonElement body, string name, out JsonElement value)
    {
        value = default;
        return body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out value);
    }

    private static string Canon(object? v) => v switch
    {
        null => "∅",
        string s => "s:" + s,
        bool b => b ? "b:1" : "b:0",
        int or long or short or decimal or double => "n:" + Convert.ToDecimal(v).ToString("0.########", CultureInfo.InvariantCulture),
        JsonElement je => "j:" + JsonSerializer.Serialize(je),
        _ => v.ToString() ?? "∅",
    };

    private static void Validate(TableDef t, Row row)
    {
        foreach (var c in t.Cols)
        {
            if (!row.TryGetValue(c.Name, out var v)) continue;
            var label = c.Label ?? c.Name;
            if (v is null)
            {
                if (!c.Nullable && c.Writable) throw ApiException.Validation($"Thiếu trường bắt buộc: {label}.");
                continue;
            }
            if (c.NonBlank && v is string s && s.Trim().Length == 0) throw ApiException.Validation($"Cần nhập {label}.");
        }
    }

    /// <summary>Client JSON → validated JSON-form value (null = SQL NULL).</summary>
    public static object? Coerce(Col c, JsonElement v)
    {
        var label = c.Label ?? c.Name;
        if (v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
        ApiException Bad(string why = "không hợp lệ") => ApiException.Validation($"Giá trị {why}: {label}.");

        switch (c.Type)
        {
            case ColType.Uuid:
            {
                if (v.ValueKind != JsonValueKind.String || !Guid.TryParse(GetString(v), out var g)) throw Bad();
                return g.ToString("D");
            }
            case ColType.Str or ColType.Text or ColType.Char:
            {
                if (v.ValueKind != JsonValueKind.String) throw Bad();
                var s = GetString(v)!;
                if (c.MaxLength > 0 && s.Length > c.MaxLength) throw Bad($"quá dài (tối đa {c.MaxLength} ký tự)");
                if (c.Values is not null && !c.Values.Contains(s)) throw Bad();
                if (c.NonBlank && s.Trim().Length == 0) throw ApiException.Validation($"Cần nhập {label}.");
                if (c.HttpUrl && !(s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                                    s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
                    throw ApiException.Validation("Đường dẫn phải bắt đầu bằng http:// hoặc https://", "url_invalid");
                return s;
            }
            case ColType.Int or ColType.Long:
            {
                if (v.ValueKind != JsonValueKind.Number) throw Bad();
                long n;
                if (v.TryGetInt64(out var l)) n = l;
                else if (v.TryGetDecimal(out var d) && d == decimal.Truncate(d)) n = (long)d;
                else throw Bad();
                if (c.Min is not null && n < c.Min || c.Max is not null && n > c.Max) throw Bad($"ngoài khoảng cho phép {c.Min}–{c.Max}");
                return c.Type == ColType.Int ? (int)n : n;
            }
            case ColType.Dec:
            {
                if (v.ValueKind != JsonValueKind.Number || !v.TryGetDecimal(out var d)) throw Bad();
                d = decimal.Round(d, 2);
                if (c.Min is not null && d < c.Min || c.Max is not null && d > c.Max) throw Bad($"ngoài khoảng cho phép {c.Min}–{c.Max}");
                return d;
            }
            case ColType.Bool:
                return v.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => throw Bad() };
            case ColType.Ts:
            {
                if (v.ValueKind != JsonValueKind.String ||
                    !DateTimeOffset.TryParse(GetString(v), CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto)) throw Bad("ngày giờ không hợp lệ");
                return Fmt.Iso(Fmt.TruncateMs(dto.UtcDateTime));
            }
            case ColType.Date:
            {
                var s = v.ValueKind == JsonValueKind.String ? GetString(v) : null;
                if (s is { Length: > 10 }) s = s[..10];
                if (s is null || !DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) throw Bad("ngày không hợp lệ");
                return s;
            }
            case ColType.Json:
                return v.Clone();
            default:
                throw Bad();
        }
    }

    /// <summary>JSON-form value → ADO.NET parameter value.</summary>
    private static object? ToDb(Col c, object? v) => v switch
    {
        null => null,
        string s when c.Type == ColType.Ts => DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).ToUniversalTime(),
        string s when c.Type == ColType.Date => DateTime.ParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture),
        JsonElement je => JsonSerializer.Serialize(je, AuditJson),
        _ => v,
    };
}
