# Runbook

## 1. Yêu cầu

- .NET SDK 10 (`dotnet --list-sdks` → 10.0.x), Node.js ≥ 18.18 (đã dùng 24) + npm.
- Mạng ra `db73041.public.databaseasp.net:3306`.
- Windows PowerShell 5.1 hoặc PowerShell 7.

## 2. Cấu hình

| Tệp | Mục đích | Ghi chú |
|---|---|---|
| `SRV_Demo/appsettings.json` | Mặc định (không bí mật), **tracked** | `ConnectionStrings:Default` để trống |
| `SRV_Demo/appsettings.Development.json` | Chỉ cấu hình log, **tracked** (do Visual Studio tạo) | **Không** đặt bí mật ở đây — git đang theo dõi file này |
| `SRV_Demo/appsettings.Local.json` | Chuỗi kết nối **thật** + `Seed:Users` (mật khẩu ban đầu) cho máy dev | **gitignore**, nạp ở mọi môi trường; mẫu: `appsettings.Local.example.json` |
| `SRV_Demo/appsettings.Production.json` | Chuỗi kết nối khi deploy (Web Deploy mang file này lên server) | **gitignore** |
| Biến môi trường `ConnectionStrings__Default` | Ghi đè chuỗi kết nối | ưu tiên cao nhất |

Thứ tự ưu tiên: `appsettings.json` < `appsettings.{Environment}.json` < `appsettings.Local.json` < biến môi trường < tham số dòng lệnh.

Khóa cấu hình khác: `Db:AutoMigrate` (mặc định true), `Db:Sandbox` (false), `Reminders:BackgroundRefresh` (true),
`Http:RedirectToHttps` (false), `Seed:Users[]`.

Chuỗi kết nối: `Server=…;Database=…;Uid=…;Pwd='…';SslMode=Preferred;` — nháy đơn quanh mật khẩu là tùy chọn (parser chấp nhận cả
mật khẩu có `=` khi không có nháy) nhưng nên dùng.

`Seed:Admin` (`Email` mặc định `admin@soragroup.vn`, `DisplayName`, `Password`): khi khởi động, nếu chưa có tài khoản với email đó thì
tạo quản trị viên mặc định. Không bao giờ đặt lại mật khẩu của tài khoản đã tồn tại. Thiếu `Password` ⇒ bỏ qua.

## 3. Chạy local

```powershell
# 1) Lần đầu hoặc sau khi sửa ClientApp/src
powershell -File scripts/build-client.ps1 -Test        # npm install, typecheck, 19 unit test, build → wwwroot/app

# 2) Chạy server
powershell -File scripts/run-dev.ps1                   # DB thật, có lưu dữ liệu
powershell -File scripts/run-dev.ps1 -Sandbox          # DB thật nhưng KHÔNG commit gì (rollback khi tắt)
# → http://localhost:5267  (tự chuyển tới /app/)
```

Phát triển giao diện với hot-reload: chạy server như trên, rồi
`cd SRV_Demo/ClientApp; npm run dev` → http://localhost:5173/app/ (Vite proxy `/api` và `/hubs` sang :5267;
đổi đích bằng biến `SORA_API_TARGET`).

Đăng nhập: `giamdoc@soragroup.vn` hoặc `thuky@soragroup.vn`; mật khẩu ban đầu ở `appsettings.Local.json → Seed:Users`.

## 4. Kiểm thử

| Lệnh | Phạm vi | Ghi chú |
|---|---|---|
| `cd SRV_Demo/ClientApp; npm test` | 19 test logic thuần (giờ VN, lọc, lịch lặp, đề xuất lịch, báo cáo, diff audit) | < 1 s |
| `npm run typecheck` | TypeScript | |
| `dotnet test SRV_Demo.Tests` | 32 test API trên DB thật ở **sandbox** (xem dưới) | ≈ 3 phút vì mỗi truy vấn đi qua mạng; cần schema đã migrate |

Test chạy trong **một transaction không commit** (`SandboxDb`), nên không để lại dòng nào kể cả audit.
Kiểm tra sau test: `cli status` → số dòng không đổi.

## 5. CLI quản trị

```powershell
dotnet run --project SRV_Demo --no-launch-profile -- cli <lệnh>    # đọc chuỗi kết nối từ appsettings.Local.json (hoặc Production.json)
```

| Lệnh | Tác dụng |
|---|---|
| `status` | Phiên bản DB, migration đã áp, số dòng từng bảng |
| `migrate` | Áp migration còn thiếu |
| `create-user --email E --name N --role admin\|director\|secretary --password P` | Tạo tài khoản (mật khẩu ≥ 8). Có thể dùng biến `SORA_PASSWORD` |
| `set-password --email E --password P` | Đặt lại mật khẩu (đăng xuất tài khoản đó khỏi mọi trình duyệt) |
| `ensure-admin` | Tạo quản trị viên mặc định từ `Seed:Admin` nếu chưa có |
| `deactivate --email E` / `activate --email E` | Khóa / mở tài khoản (hiệu lực ≤ 30 s) |
| `seed-demo` / `purge-demo` | Nạp / gỡ dữ liệu minh họa (`[MINH HỌA]`) |

## 6. Thêm migration

1. Tạo `SRV_Demo/Data/Migrations/002_<tên>.sql` (các câu lệnh cách nhau bằng dòng `-- GO`; viết `IF NOT EXISTS`/idempotent nếu có thể).
2. Cập nhật `Data/Tables.cs` nếu thêm cột/bảng; cập nhật `docs/DATABASE.md`.
3. `cli migrate` (hoặc khởi động app). **Không bao giờ sửa file migration đã áp.**
4. Thêm test.

## 7. Deploy (Visual Studio Web Deploy → http://srv.runasp.net/)

Đã có profile `SRV_Demo/Properties/PublishProfiles/site98001-WebDeploy.pubxml` (MonsterASP, `site98001`). Mật khẩu deploy nằm ở
`*.pubxml.user` — **không đọc, không commit**.

1. `powershell -File scripts/build-client.ps1` — **bắt buộc**: publish mang theo `wwwroot/app` đã build, không build React hộ.
2. Đảm bảo có `SRV_Demo/appsettings.Production.json` (chuỗi kết nối). `appsettings.Local*.json` cố ý **không** được publish.
3. Visual Studio → Publish (Release). Hoặc CLI: `dotnet publish SRV_Demo -c Release -o <thư mục>` rồi đưa lên host.
4. Kiểm tra: `GET /api/health` phải trả `status: ok` và `migrations: ["001_init"]`.
5. WebSocket trên IIS shared có thể bị tắt: SignalR tự rơi về Server-Sent Events/long-polling; giao diện vẫn "Đồng bộ".

Môi trường Production mặc định: không chuyển hướng HTTPS (đặt `Http:RedirectToHttps=true` nếu host có HTTPS binding mà app thấy được);
cookie chỉ `Secure` khi request là HTTPS.

## 8. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| App không lên / `/api/health` lỗi | Thiếu `ConnectionStrings:Default`, sai mật khẩu, DB không tới được | Xem log; `cli status`; kiểm tra tường lửa/mật khẩu |
| `Format of the initialization string…` | Chuỗi kết nối sai cú pháp (thiếu `;`, dấu nháy không đóng…) | Kiểm tra từng cặp `Key=Value;` |
| Đăng nhập admin bị 401 sau khi đổi mật khẩu ở nơi khác | Cookie cũ bị thu hồi khi mật khẩu đổi | Đăng nhập lại bằng mật khẩu mới |
| Đăng nhập 401 | Sai mật khẩu / tài khoản bị khóa / đang bị khóa 5′ | `cli set-password`, `cli activate`, đợi 5′ |
| 403 `forbidden` ở mọi POST | Thiếu header `X-Requested-With: sora` (gọi API ngoài `api.ts`) | Thêm header |
| 409 `version_conflict` | Người kia đã lưu trước | UI hiện nút "Tải bản mới nhất" |
| Giao diện trống / 404 ở `/app/` | Chưa build client | `scripts/build-client.ps1` |
| Chậm | RTT tới DB (host DB ở xa) | Đặt app gần DB; giảm số lần tải lại |
| "Mất kết nối" ở thanh trên | SignalR không nối được | Kiểm tra `/hubs/workspace/negotiate` (cookie, proxy/WebSocket) |
| `dotnet build` lỗi file đang bị khóa | Server dev còn chạy | Tắt tiến trình `SRV_Demo` |
