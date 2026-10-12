using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SRV_Demo.Data;

namespace SRV_Demo.Services;

/// <summary>Who currently has the app open (replaces Supabase Realtime presence). Single-instance, in-memory.</summary>
public sealed class PresenceTracker
{
    private readonly ConcurrentDictionary<string, string> _connections = new();

    public void Add(string connectionId, string name) => _connections[connectionId] = name;
    public void Remove(string connectionId) => _connections.TryRemove(connectionId, out _);
    public string[] Names() => _connections.Values.Distinct().OrderBy(n => n).ToArray();
}

/// <summary>
/// One hub, one server→client message:
///   "change"   { table, action: INSERT|UPDATE|DELETE, row }   — a committed row change (replaces postgres_changes)
///   "presence" string[]                                       — display names of connected users
/// Clients never write through the hub; all writes go through the REST API.
/// </summary>
[Authorize]
public sealed class WorkspaceHub(PresenceTracker presence) : Hub
{
    public override async Task OnConnectedAsync()
    {
        presence.Add(Context.ConnectionId, Context.User?.FindFirstValue(ClaimTypes.Name) ?? "?");
        await Clients.All.SendAsync("presence", presence.Names());
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        presence.Remove(Context.ConnectionId);
        await Clients.All.SendAsync("presence", presence.Names());
        await base.OnDisconnectedAsync(exception);
    }
}

public sealed class SignalRRealtime(IHubContext<WorkspaceHub> hub) : IRealtime
{
    public async Task PublishAsync(IReadOnlyCollection<ChangeEvent> events)
    {
        foreach (var e in events)
        {
            var payload = new { table = e.Table, action = e.Action, row = e.Row };
            if (e.ToUserId is null) await hub.Clients.All.SendAsync("change", payload);
            else await hub.Clients.User(e.ToUserId).SendAsync("change", payload);
        }
    }
}
