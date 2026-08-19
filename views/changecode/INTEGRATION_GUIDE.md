# Messaging System — FINAL Integration Guide

## 1. Files kahan rakhni hain

```
app.messaging.final.js        <- iska CONTENT apne app.js me paste karna hai
models/message.js
models/messageSettings.js
models/notification.js
models/pushSubscription.js    (optional — Web Push)
utils/webPush.js              (optional — Web Push)
public/css/messaging.css
public/js/socketClient.js
views/admin/messages/*.ejs
views/teacher/messages/*.ejs
views/student/messages/*.ejs
```

## 2. Install

```bash
npm install socket.io
npm install web-push          # sirf agar closed-browser push chahiye
```

## 3. `app.js` me changes

1. `app.messaging.final.js` ka **poora content** apne `app.js` ke andar,
   `sessionMiddleware` define hone ke turant baad paste karo.
2. Agar kahin `app.listen(...)` already likha hai, **usse HATA do** —
   ab file ke end me `server.listen(...)` chalega (Section F).
3. `<script src="/socket.io/socket.io.js"></script>` extra serve karne
   ki zarurat nahi — socket.io khud attach kar deta hai jab server par lagi ho.

## 4. 🔒 COMPLETE ROUTE MAP (security: role = route prefix)

### ADMIN (`isAdminVerified` guard)
| Method | Route | Kaam |
|---|---|---|
| GET | `/admin/message/student/compose` | Student ko message likhne ka form |
| POST | `/admin/message/student` | Student ko bhejna (all/filter/individual) |
| GET | `/admin/message/student/sent` | Bheje hue student messages ki list |
| PUT | `/admin/message/student/:id` | Edit (apna hi message) |
| DELETE | `/admin/message/student/:id` | Soft delete |
| GET | `/admin/message/teacher/compose` | Teacher ko message likhne ka form |
| POST | `/admin/message/teacher` | Teacher(s) ko bhejna (bulk = per-teacher alag doc) |
| GET | `/admin/message/teacher/sent` | Bheje hue teacher messages ki list |
| PUT | `/admin/message/teacher/:id` | Edit |
| DELETE | `/admin/message/teacher/:id` | Delete |
| GET | `/admin/message/received` | Teacher/Student se aayi replies |
| POST | `/admin/message/:id/reply` | Admin reply kare (sirf apne-aap ko addressed msg par) |
| GET | `/admin/message/meta/semesters?class=` | Cascading dropdown |
| GET | `/admin/message/meta/sections?class=&semester=` | Cascading dropdown |
| GET | `/admin/message/student/search?q=` | Individual student search |
| GET | `/admin/message/teacher/search?q=` | Teacher search |
| GET | `/admin/message/settings` | Reply-permission settings page |
| POST | `/admin/message/settings/toggle-student-reply` | Toggle on/off |
| GET | `/admin/notifications/unread-count` | Badge count |
| POST | `/admin/notifications/mark-all-read` | Mark read |

### TEACHER (`isLoggedIn` guard)
| Method | Route | Kaam |
|---|---|---|
| GET | `/teacher/message/student/compose` | Form — sirf apni assigned classes dikhengi |
| POST | `/teacher/message/student` | Bhejna (permission-checked) |
| GET | `/teacher/message/student/sent` | Sent list |
| PUT | `/teacher/message/student/:id` | Edit |
| DELETE | `/teacher/message/student/:id` | Delete |
| GET | `/teacher/message/received` | Admin se + student replies |
| POST | `/teacher/message/:id/reply` | Reply (hamesha allowed, apna hi addressed msg) |
| GET | `/teacher/message/meta/semesters?class=` | Scoped to apni assigned class |
| GET | `/teacher/message/meta/sections?class=&semester=` | Scoped |
| GET | `/teacher/message/student/search?q=` | Sirf apne assigned students |
| GET | `/teacher/notifications/unread-count` | Badge |
| POST | `/teacher/notifications/mark-all-read` | Mark read |

### STUDENT (`isStudentVerified` guard)
| Method | Route | Kaam |
|---|---|---|
| GET | `/student/message` | Inbox (broadcast + individual) |
| POST | `/student/message/:id/reply` | Reply — admin ke toggle se gated |
| GET | `/student/notifications/unread-count` | Badge |
| POST | `/student/notifications/mark-all-read` | Mark read |

**Security note**: har route apne role ke prefix + middleware ke peeche hai.
Edit/Delete/Reply ke andar bhi DOUBLE ownership check hai
(`sender.id === req.user._id AND sender.role === <current role>`), taaki
koi bhi role kisi doosre role ka data modify na kar sake — even agar koi
ID guess kar le.

## 5. Testing checklist (final, sequence me)

1. ✅ Admin "All students" → 1 doc, `audienceType:"all"`
2. ✅ Admin filter (class+sem+sec) → students us combo ke, list me stamp dikhe
3. ✅ Admin individual student → sent list me `Roll #.. Name Class Sem Section` dikhe
4. ✅ Admin 3 teachers bulk → DB me 3 alag docs, `/admin/message/teacher/sent` me 3 alag row
5. ✅ Teacher apni class ke bahar filter try kare (Postman se `/teacher/message/student` POST) → error flash, doc na bane
6. ✅ Teacher ko `/teacher/message/received` par admin ka message dikhe → reply kare → admin ko `/admin/message/received` par dikhe
7. ✅ Student ko `/student/message` par dikhe → reply kare jab `allowStudentReply:false` ho → error aana chahiye
8. ✅ Admin settings toggle ON kare → student ka reply box turant kaam kare (page reload ke baad `canReply` update hoga)
9. ✅ Socket: 2 tabs (student + admin), admin bheje, student tab me bina refresh toast aaye
10. ✅ Student tab band karke wapas login kare → `/student/notifications/unread-count` me pending count dikhe

## 6. Ek cheez jo abhi bhi manual hai

- `<% layout("layouts/boilerplate") %>` line har view ke top par **comment me** hai — apne project ka layout use karta hai to uncomment kar dena, warna standalone render hoga (CSS/JS sab kaam karega, bas apka navbar/header wrap nahi hoga).
- Web Push (poori tarah band browser me notification) abhi bhi scaffold hi hai — VAPID keys + service-worker.js + subscribe UI banana baaki hai agar chahiye to.
