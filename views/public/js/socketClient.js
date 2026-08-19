// public/js/socketClient.js
//
// USAGE: Har role ke EJS view me is script se PEHLE ye line honi chahiye:
//   <script>window.CURRENT_USER_ROLE = "Admin";</script>   (ya "Teacher" / "Student")
// Isse pata chalta hai kis role ka /unread-count route call karna hai
// (routes ab role-scoped hain: /admin/notifications/..., /teacher/..., /student/...)

const socket = io({ withCredentials: true });

socket.on("connect", () => {
  console.log("🔌 Connected to notification server");
});

socket.on("new-message", (msg) => {
  showToast(`New message from ${msg.sender.name}: ${msg.content.slice(0, 60)}`);
  bumpUnreadBadge();
});

socket.on("new-reply", (msg) => {
  showToast(`${msg.sender.name} replied: ${msg.content.slice(0, 60)}`);
  bumpUnreadBadge();
});

function showToast(text) {
  const toast = document.createElement("div");
  toast.className = "msg-toast";
  toast.innerText = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function unreadCountUrl() {
  const role = window.CURRENT_USER_ROLE;
  if (role === "Admin") return "/admin/notifications/unread-count";
  if (role === "Teacher") return "/teacher/notifications/unread-count";
  if (role === "Student") return "/student/notifications/unread-count";
  return null;
}

function bumpUnreadBadge() {
  const url = unreadCountUrl();
  if (!url) return; // role set nahi hai to silently skip

  fetch(url)
    .then((res) => res.json())
    .then(({ count }) => {
      const badge = document.getElementById("notif-badge");
      if (badge) {
        badge.innerText = count;
        badge.style.display = count > 0 ? "inline-block" : "none";
      }
    })
    .catch(() => {}); // network hiccup — silently ignore, agla event try karega
}

document.addEventListener("DOMContentLoaded", bumpUnreadBadge);
