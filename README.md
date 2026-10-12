# SORA Executive Workspace — ASP.NET Core + MariaDB/MySQL

Web app điều hành cho **Giám đốc** và **Thư ký**: công việc, giao việc & đôn đốc, lịch (lặp, kéo thả, phát hiện trùng),
đề xuất xếp lịch, nhắc việc, mục tiêu, báo cáo tuần, danh bạ, nhật ký thay đổi; hai tài khoản quyền ngang nhau, đồng bộ thời gian thực.

Chuyển từ bản React + Supabase sang **ASP.NET Core 10 + MariaDB/MySQL (DB thật)**. Giao diện React giữ nguyên, phục vụ tại `/app/`.

## Chạy nhanh

```powershell
powershell -File scripts/build-client.ps1 -Test      # lần đầu / sau khi sửa ClientApp
powershell -File scripts/run-dev.ps1 -Sandbox        # http://localhost:5267 — ghi gì cũng bị rollback khi tắt
powershell -File scripts/run-dev.ps1                 # ghi vào DB thật
dotnet test SRV_Demo.Tests                           # 32 test API (sandbox, không để lại dữ liệu)
```

Cần `SRV_Demo/appsettings.Local.json` (chuỗi kết nối + `Seed:Users`; không commit) — mẫu: `appsettings.Local.example.json`.

## Tài liệu

- **[AGENT.md](AGENT.md)** — điểm vào cho AI/lập trình viên tiếp quản (quy tắc, bẫy, quy trình bàn giao)
- [docs/HANDOVER.md](docs/HANDOVER.md) — trạng thái hiện tại + nhật ký phiên
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DATABASE.md](docs/DATABASE.md) · [docs/API.md](docs/API.md)
- [docs/MIGRATION_MAP.md](docs/MIGRATION_MAP.md) · [docs/RUNBOOK.md](docs/RUNBOOK.md) · [docs/DECISIONS.md](docs/DECISIONS.md)

## Cấu trúc

```
SRV_Demo/            ASP.NET Core (Api, Data, Services, Common) + ClientApp (React) + wwwroot/app (bundle)
SRV_Demo.Tests/      integration test (xUnit, WebApplicationFactory, sandbox)
docs/  scripts/      tài liệu · script build/chạy
sora-executive-workspace/   mã Supabase gốc (tham chiếu)
```
