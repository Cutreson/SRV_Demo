namespace SRV_Demo.Services;

/// <summary>
/// Replacement for the pg_cron job of the Supabase version: recompute reminders every 15 minutes even when nobody
/// has the app open, so a browser that opens later (or a tab that was asleep) already finds them.
/// Disable with <c>Reminders:BackgroundRefresh=false</c>.
/// </summary>
public sealed class ReminderJob(NotificationService notifications, IConfiguration cfg, ILogger<ReminderJob> log) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!cfg.GetValue("Reminders:BackgroundRefresh", true)) return;
        using var timer = new PeriodicTimer(Interval);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    var created = await notifications.RefreshAsync();
                    if (created > 0) log.LogInformation("Reminder job created {Count} reminders", created);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    log.LogWarning(e, "Reminder job failed; will retry in {Minutes} min", Interval.TotalMinutes);
                }
            }
        }
        catch (OperationCanceledException) { /* shutting down */ }
    }
}
