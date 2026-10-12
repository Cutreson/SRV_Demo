-- Sau khi tạo 2 user trong Supabase → Authentication → Users (Add user, tắt "Send invite" nếu muốn đặt mật khẩu trực tiếp),
-- thay email bên dưới rồi chạy trong SQL Editor để cấp quyền Giám đốc / Thư ký.
insert into public.profiles (id, display_name, role)
select id, 'Đào Trọng Tài', 'director'  from auth.users where email = 'EMAIL-GIAM-DOC@soragroup.vn'
on conflict (id) do update set role = excluded.role, display_name = excluded.display_name, active = true;

insert into public.profiles (id, display_name, role)
select id, 'Thư ký', 'secretary' from auth.users where email = 'EMAIL-THU-KY@soragroup.vn'
on conflict (id) do update set role = excluded.role, display_name = excluded.display_name, active = true;

-- Thu hồi quyền một người: update public.profiles set active = false where id = '...';
