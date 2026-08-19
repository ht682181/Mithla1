// =========================================================================
// 🔥 COMPLETE MESSAGING SYSTEM — FINAL VERSION
// =========================================================================
// Bhai ye poora block apne app.js ke andar paste karna hai.
//
// 🔒 SECURITY DESIGN (jaisa tune bola):
// Har role ka apna ALAG route hai save/reply/edit/delete ke liye.
// Ek role dusre role ke route se kabhi data save/modify nahi kar sakta,
// kyunki:
//   1. Route prefix hi alag hai (/admin/..., /teacher/..., /student/...)
//   2. Har route par uss role ka STRICT middleware laga hai
//      (isAdminVerified / isLoggedIn / isStudentVerified)
//   3. Edit/Delete/Reply ke andar bhi DOUBLE check hai:
//      sender.id === req.user._id  AND  sender.role === current role
//
// SECTIONS:
//   A -> requires + http server + socket.io (inline, koi alag module nahi)
//   B -> shared helper functions (permission checks, notification dispatch)
//   C -> ADMIN ROUTES        (/admin/message/...)
//   D -> TEACHER ROUTES      (/teacher/message/...)
//   E -> STUDENT ROUTES      (/student/message/...)
//   F -> server.listen()     (SABSE NEECHE)
// =========================================================================


// #########################################################################
// SECTION A — REQUIRES + HTTP SERVER + SOCKET.IO
// #########################################################################

const http = require("http");
const { Server } = require("socket.io");

const Message = require("./models/message.js");
const MessageSettings = require("./models/messageSettings.js");
const Notification = require("./models/notification.js");
// Student, Teacher, Admin, ExpressError, WrapAsync already required upar
// tere original app.js me — dobara require nahi kar rahe taaki duplicate
// binding na bane.

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

// Express-session ko socket ke saath share karna — WAHI sessionMiddleware
// instance use karna jo upar "app.use(sessionMiddleware)" me bana hai.
io.engine.use(sessionMiddleware);

function roomForClassFilter(cls, semester, section) {
  return `class:${cls}:${semester}:${section}`;
}
function roomForUser(role, userId) {
  return `user:${role}:${userId}`;
}

io.on("connection", async (socket) => {
  try {
    const session = socket.request.session;
    const userId = session?.userId;
    const role = session?.role;
    if (!userId || !role) return;

    socket.join(roomForUser(role, userId));

    if (role === "Admin") {
      socket.join("room:admins");
    }

    if (role === "Student") {
      socket.join("room:all-students");
      const student = await Student.findById(userId).select("class semester section");
      if (student) {
        socket.join(roomForClassFilter(student.class, student.semester, student.section));
      }
    }

    if (role === "Teacher") {
      socket.join("room:all-teachers");
    }
  } catch (err) {
    console.error("Socket connection error:", err);
  }
});


// #########################################################################
// SECTION B — SHARED HELPERS (permission checks + notification dispatch)
// #########################################################################

// 🔒 Teacher ke paas is class/semester/section ka access hai ya nahi
function teacherHasAccess(teacher, className, semester, section) {
  if (!className || !semester || !section) return false;
  const cls = teacher.class.find((c) => c.className === className);
  if (!cls) return false;
  const sem = cls.semesters.find((s) => s.semester === semester);
  if (!sem) return false;
  const sec = sem.sections.find((sec) => sec.section === section);
  return !!sec;
}

// Teacher ki saari assigned class/semester/section combos ek flat array me
function teacherAssignedCombos(teacher) {
  const combos = [];
  for (const cls of teacher.class || []) {
    for (const sem of cls.semesters || []) {
      for (const sec of sem.sections || []) {
        combos.push({ class: cls.className, semester: sem.semester, section: sec.section });
      }
    }
  }
  return combos;
}

function serializeForEmit(message) {
  return {
    _id: message._id,
    sender: message.sender,
    recipientRole: message.recipientRole,
    audienceType: message.audienceType,
    filter: message.filter,
    recipientId: message.recipientId,
    content: message.content,
    parentMessage: message.parentMessage,
    isReply: message.isReply,
    createdAt: message.createdAt,
  };
}

async function resolveStudentRecipients(message) {
  if (message.audienceType === "all") {
    return Student.find({ status: "Active" }).select("_id");
  }
  if (message.audienceType === "filter") {
    return Student.find({
      status: "Active",
      class: message.filter.class,
      semester: message.filter.semester,
      section: message.filter.section,
    }).select("_id");
  }
  if (message.audienceType === "individual" && message.recipientId) {
    return [{ _id: message.recipientId }];
  }
  return [];
}

// Master dispatch — DB me notification persist + socket se live emit
async function dispatchMessageNotification(message) {
  const title = `New message from ${message.sender.name} (${message.sender.role})`;
  const preview = message.content.slice(0, 120);

  if (message.recipientRole === "Student") {
    const recipients = await resolveStudentRecipients(message);
    const docs = recipients.map((r) => ({
      recipientId: r._id,
      recipientRole: "Student",
      message: message._id,
      title,
      preview,
      isDelivered: true,
    }));
    if (docs.length) await Notification.insertMany(docs);

    if (message.audienceType === "all") {
      io.to("room:all-students").emit("new-message", serializeForEmit(message));
    } else if (message.audienceType === "filter") {
      io.to(roomForClassFilter(message.filter.class, message.filter.semester, message.filter.section))
        .emit("new-message", serializeForEmit(message));
    } else if (message.audienceType === "individual") {
      io.to(roomForUser("Student", message.recipientId)).emit("new-message", serializeForEmit(message));
    }
  }

  if (message.recipientRole === "Teacher" && message.recipientId) {
    await Notification.create({
      recipientId: message.recipientId,
      recipientRole: "Teacher",
      message: message._id,
      title,
      preview,
      isDelivered: true,
    });
    io.to(roomForUser("Teacher", message.recipientId)).emit("new-message", serializeForEmit(message));
  }

  if (message.recipientRole === "Admin" && message.recipientId) {
    await Notification.create({
      recipientId: message.recipientId,
      recipientRole: "Admin",
      message: message._id,
      title,
      preview,
      isDelivered: true,
    });
    io.to(roomForUser("Admin", message.recipientId)).emit("new-message", serializeForEmit(message));
  }
}

async function dispatchReplyNotification(replyMessage, originalSenderRole, originalSenderId) {
  const title = `${replyMessage.sender.name} replied to your message`;
  const preview = replyMessage.content.slice(0, 120);

  await Notification.create({
    recipientId: originalSenderId,
    recipientRole: originalSenderRole,
    message: replyMessage._id,
    title,
    preview,
    isDelivered: true,
  });

  io.to(roomForUser(originalSenderRole, originalSenderId)).emit("new-reply", serializeForEmit(replyMessage));
}


// #########################################################################
// SECTION C — ADMIN ROUTES  (/admin/message/...)
// #########################################################################

// ================= COMPOSE PAGES =================
app.get(
  "/admin/message/student/compose",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const classes = await Student.distinct("class", { status: "Active" });
    res.render("admin/messages/compose-student.ejs", { classes });
  })
);

app.get(
  "/admin/message/teacher/compose",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const teachers = await Teacher.find({ status: "Active" }).select("name email mobile").sort({ name: 1 });
    res.render("admin/messages/compose-teacher.ejs", { teachers });
  })
);

// ================= ADMIN -> STUDENT (create) =================
app.post(
  "/admin/message/student",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { audienceType, class: className, semester, section, studentId, content } = req.body;

    if (!content || !content.trim()) {
      req.flash("error", "Message content is required.");
      return res.redirect("back");
    }

    let payload = {
      sender: { id: req.user._id, role: "Admin", name: req.user.name },
      recipientRole: "Student",
      content: content.trim(),
    };

    if (audienceType === "all") {
      payload.audienceType = "all";
    } else if (audienceType === "individual") {
      const student = await Student.findById(studentId);
      if (!student) {
        req.flash("error", "Student not found.");
        return res.redirect("back");
      }
      payload.audienceType = "individual";
      payload.recipientId = student._id;
    } else if (audienceType === "filter") {
      if (!className || !semester || !section) {
        req.flash("error", "Class, semester and section are required.");
        return res.redirect("back");
      }
      payload.audienceType = "filter";
      payload.filter = { class: className, semester, section };
    } else {
      req.flash("error", "Invalid audience type.");
      return res.redirect("back");
    }

    const message = await Message.create(payload);
    await dispatchMessageNotification(message);

    req.flash("success", "Message sent to students successfully.");
    return res.redirect("/admin/message/student/sent");
  })
);

// ================= ADMIN -> STUDENT (sent list) =================
app.get(
  "/admin/message/student/sent",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const studentMessages = await Message.find({
      "sender.id": req.user._id,
      "sender.role": "Admin",
      recipientRole: "Student",
      isDeleted: false,
    })
      .populate("recipientId", "name rollNo class semester section")
      .sort({ createdAt: -1 });

    res.render("admin/messages/sent-student.ejs", { studentMessages });
  })
);

// ================= ADMIN -> STUDENT (edit / delete — own messages only) =================
app.put(
  "/admin/message/student/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) {
      req.flash("error", "Message not found.");
      return res.redirect("back");
    }
    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
      req.flash("error", "You can only edit your own messages.");
      return res.redirect("back");
    }
    message.content = (req.body.content || "").trim();
    if (!message.content) {
      req.flash("error", "Message cannot be empty.");
      return res.redirect("back");
    }
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    req.flash("success", "Message updated.");
    return res.redirect("back");
  })
);

app.delete(
  "/admin/message/student/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) {
      req.flash("error", "Message not found.");
      return res.redirect("back");
    }
    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
      req.flash("error", "You can only delete your own messages.");
      return res.redirect("back");
    }
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    req.flash("success", "Message deleted.");
    return res.redirect("back");
  })
);

// ================= ADMIN -> TEACHER (create — bulk = per-teacher alag doc) =================
app.post(
  "/admin/message/teacher",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { audienceType, teacherIds, content } = req.body;

    if (!content || !content.trim()) {
      req.flash("error", "Message content is required.");
      return res.redirect("back");
    }

    let targetTeacherIds = [];
    if (audienceType === "all") {
      const allTeachers = await Teacher.find({ status: "Active" }).select("_id");
      targetTeacherIds = allTeachers.map((t) => t._id);
    } else {
      targetTeacherIds = Array.isArray(teacherIds) ? teacherIds : [teacherIds].filter(Boolean);
    }

    if (!targetTeacherIds.length) {
      req.flash("error", "Please select at least one teacher.");
      return res.redirect("back");
    }

    const teachers = await Teacher.find({ _id: { $in: targetTeacherIds }, status: "Active" }).select("_id");
    if (!teachers.length) {
      req.flash("error", "No valid teachers found.");
      return res.redirect("back");
    }

    const createdMessages = [];
    for (const teacher of teachers) {
      const msg = await Message.create({
        sender: { id: req.user._id, role: "Admin", name: req.user.name },
        recipientRole: "Teacher",
        audienceType: "individual",
        recipientId: teacher._id,
        content: content.trim(),
      });
      createdMessages.push(msg);
    }

    await Promise.all(createdMessages.map((m) => dispatchMessageNotification(m)));

    req.flash("success", `Message sent to ${teachers.length} teacher(s).`);
    return res.redirect("/admin/message/teacher/sent");
  })
);

// ================= ADMIN -> TEACHER (sent list) =================
app.get(
  "/admin/message/teacher/sent",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const teacherMessages = await Message.find({
      "sender.id": req.user._id,
      "sender.role": "Admin",
      recipientRole: "Teacher",
      isDeleted: false,
    })
      .populate("recipientId", "name email")
      .sort({ createdAt: -1 });

    res.render("admin/messages/sent-teacher.ejs", { teacherMessages });
  })
);

// ================= ADMIN -> TEACHER (edit / delete) =================
app.put(
  "/admin/message/teacher/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) {
      req.flash("error", "Message not found.");
      return res.redirect("back");
    }
    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
      req.flash("error", "You can only edit your own messages.");
      return res.redirect("back");
    }
    message.content = (req.body.content || "").trim();
    if (!message.content) {
      req.flash("error", "Message cannot be empty.");
      return res.redirect("back");
    }
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    req.flash("success", "Message updated.");
    return res.redirect("back");
  })
);

app.delete(
  "/admin/message/teacher/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) {
      req.flash("error", "Message not found.");
      return res.redirect("back");
    }
    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
      req.flash("error", "You can only delete your own messages.");
      return res.redirect("back");
    }
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    req.flash("success", "Message deleted.");
    return res.redirect("back");
  })
);

// ================= ADMIN — RECEIVED (replies from teachers/students) =================
app.get(
  "/admin/message/received",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const receivedMessages = await Message.find({
      recipientRole: "Admin",
      recipientId: req.user._id,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    res.render("admin/messages/received.ejs", { receivedMessages });
  })
);

// ================= ADMIN — REPLY (only to messages addressed to this admin) =================
app.post(
  "/admin/message/:id/reply",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) {
      req.flash("error", "Reply cannot be empty.");
      return res.redirect("back");
    }

    const parent = await Message.findById(req.params.id);
    if (!parent || parent.isDeleted) {
      req.flash("error", "Original message not found.");
      return res.redirect("back");
    }

    // 🔒 Admin sirf apne-aap ko bheje gaye message par reply kar sakta hai
    if (parent.recipientRole !== "Admin" || String(parent.recipientId) !== String(req.user._id)) {
      req.flash("error", "You cannot reply to this message.");
      return res.redirect("back");
    }

    const reply = await Message.create({
      sender: { id: req.user._id, role: "Admin", name: req.user.name },
      recipientRole: parent.sender.role,
      audienceType: "individual",
      recipientId: parent.sender.id,
      content: content.trim(),
      parentMessage: parent._id,
      isReply: true,
    });

    await dispatchReplyNotification(reply, parent.sender.role, parent.sender.id);

    req.flash("success", "Reply sent.");
    return res.redirect("back");
  })
);

// ================= ADMIN — META (cascading dropdowns, global — admin sees everything) =================
app.get(
  "/admin/message/meta/semesters",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { class: className } = req.query;
    if (!className) return res.json({ semesters: [] });
    const semesters = await Student.distinct("semester", { class: className, status: "Active" });
    res.json({ semesters });
  })
);

app.get(
  "/admin/message/meta/sections",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { class: className, semester } = req.query;
    if (!className || !semester) return res.json({ sections: [] });
    const sections = await Student.distinct("section", { class: className, semester, status: "Active" });
    res.json({ sections });
  })
);

app.get(
  "/admin/message/student/search",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json({ students: [] });

    const query = q.trim();
    const isNumeric = /^\d+$/.test(query);

    const students = await Student.find({
      status: "Active",
      $or: [{ name: { $regex: query, $options: "i" } }, ...(isNumeric ? [{ rollNo: Number(query) }] : [])],
    })
      .select("name rollNo class semester section")
      .limit(15);

    res.json({ students });
  })
);

app.get(
  "/admin/message/teacher/search",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json({ teachers: [] });

    const teachers = await Teacher.find({
      status: "Active",
      $or: [{ name: { $regex: q.trim(), $options: "i" } }, { mobile: { $regex: q.trim(), $options: "i" } }],
    })
      .select("name email mobile")
      .limit(20);

    res.json({ teachers });
  })
);

// ================= ADMIN — REPLY PERMISSION SETTINGS =================
app.get(
  "/admin/message/settings",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const settings = await MessageSettings.getSettings();
    res.render("admin/messages/settings.ejs", { settings });
  })
);

app.post(
  "/admin/message/settings/toggle-student-reply",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const settings = await MessageSettings.getSettings();
    settings.allowStudentReply = !settings.allowStudentReply;
    await settings.save();

    req.flash("success", `Student reply is now ${settings.allowStudentReply ? "ENABLED" : "DISABLED"}.`);
    return res.redirect("back");
  })
);

// ================= ADMIN — NOTIFICATIONS =================
app.get(
  "/admin/notifications/unread-count",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const count = await Notification.countDocuments({
      recipientId: req.user._id,
      recipientRole: "Admin",
      isRead: false,
    });
    res.json({ count });
  })
);

app.post(
  "/admin/notifications/mark-all-read",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    await Notification.updateMany(
      { recipientId: req.user._id, recipientRole: "Admin", isRead: false },
      { $set: { isRead: true } }
    );
    res.json({ success: true });
  })
);


// #########################################################################
// SECTION D — TEACHER ROUTES  (/teacher/message/...)
// #########################################################################

// ================= COMPOSE PAGE =================
app.get(
  "/teacher/message/student/compose",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    // Sirf teacher ki apni assigned classes (koi global list nahi — permission by design)
    const classes = [...new Set((req.user.class || []).map((c) => c.className))];
    res.render("teacher/messages/compose-student.ejs", { classes });
  })
);

// ================= TEACHER -> STUDENT (create — apni assigned class ke andar hi) =================
app.post(
  "/teacher/message/student",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const { audienceType, class: className, semester, section, studentId, content, subjectId, subjectName } = req.body;

    if (!content || !content.trim()) {
      req.flash("error", "Message content is required.");
      return res.redirect("back");
    }

    let payload = {
      sender: { id: req.user._id, role: "Teacher", name: req.user.name },
      recipientRole: "Student",
      content: content.trim(),
    };

    if (subjectId && subjectName) {
      payload.subjectContext = { subjectId, subjectName };
    }

    if (audienceType === "individual") {
      const student = await Student.findById(studentId);
      if (!student) {
        req.flash("error", "Student not found.");
        return res.redirect("back");
      }
      // 🔒 PERMISSION CHECK
      if (!teacherHasAccess(req.user, student.class, student.semester, student.section)) {
        req.flash("error", "You don't have permission to message this student.");
        return res.redirect("back");
      }
      payload.audienceType = "individual";
      payload.recipientId = student._id;
    } else if (audienceType === "filter") {
      if (!className || !semester || !section) {
        req.flash("error", "Class, semester and section are required.");
        return res.redirect("back");
      }
      // 🔒 PERMISSION CHECK
      if (!teacherHasAccess(req.user, className, semester, section)) {
        req.flash("error", "You are not assigned to this class/semester/section.");
        return res.redirect("back");
      }
      payload.audienceType = "filter";
      payload.filter = { class: className, semester, section };
    } else {
      req.flash("error", "Invalid audience type.");
      return res.redirect("back");
    }

    const message = await Message.create(payload);
    await dispatchMessageNotification(message);

    req.flash("success", "Message sent to students successfully.");
    return res.redirect("/teacher/message/student/sent");
  })
);

// ================= TEACHER -> STUDENT (sent list) =================
app.get(
  "/teacher/message/student/sent",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const sentMessages = await Message.find({
      "sender.id": req.user._id,
      "sender.role": "Teacher",
      recipientRole: "Student",
      isDeleted: false,
    })
      .populate("recipientId", "name rollNo class semester section")
      .sort({ createdAt: -1 });

    res.render("teacher/messages/sent-student.ejs", { sentMessages });
  })
);

// ================= TEACHER -> STUDENT (edit / delete) =================
app.put(
  "/teacher/message/student/:id",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) {
      req.flash("error", "Message not found.");
      return res.redirect("back");
    }
    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Teacher") {
      req.flash("error", "You can only edit your own messages.");
      return res.redirect("back");
    }
    message.content = (req.body.content || "").trim();
    if (!message.content) {
      req.flash("error", "Message cannot be empty.");
      return res.redirect("back");
    }
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    req.flash("success", "Message updated.");
    return res.redirect("back");
  })
);

app.delete(
  "/teacher/message/student/:id",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) {
      req.flash("error", "Message not found.");
      return res.redirect("back");
    }
    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Teacher") {
      req.flash("error", "You can only delete your own messages.");
      return res.redirect("back");
    }
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    req.flash("success", "Message deleted.");
    return res.redirect("back");
  })
);

// ================= TEACHER — RECEIVED (from Admin + replies from Students) =================
app.get(
  "/teacher/message/received",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const receivedMessages = await Message.find({
      recipientRole: "Teacher",
      recipientId: req.user._id,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    res.render("teacher/messages/received.ejs", { receivedMessages });
  })
);

// ================= TEACHER — REPLY (hamesha allowed, admin permission ki zarurat nahi) =================
app.post(
  "/teacher/message/:id/reply",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) {
      req.flash("error", "Reply cannot be empty.");
      return res.redirect("back");
    }

    const parent = await Message.findById(req.params.id);
    if (!parent || parent.isDeleted) {
      req.flash("error", "Original message not found.");
      return res.redirect("back");
    }

    // 🔒 Teacher sirf apne-aap ko bheje gaye message par reply kar sakta hai
    if (parent.recipientRole !== "Teacher" || String(parent.recipientId) !== String(req.user._id)) {
      req.flash("error", "You cannot reply to this message.");
      return res.redirect("back");
    }

    const reply = await Message.create({
      sender: { id: req.user._id, role: "Teacher", name: req.user.name },
      recipientRole: parent.sender.role,
      audienceType: "individual",
      recipientId: parent.sender.id,
      content: content.trim(),
      parentMessage: parent._id,
      isReply: true,
    });

    await dispatchReplyNotification(reply, parent.sender.role, parent.sender.id);

    req.flash("success", "Reply sent.");
    return res.redirect("back");
  })
);

// ================= TEACHER — META (scoped strictly to own assigned classes) =================
app.get(
  "/teacher/message/meta/semesters",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const { class: className } = req.query;
    const cls = (req.user.class || []).find((c) => c.className === className);
    const semesters = cls ? cls.semesters.map((s) => s.semester) : [];
    res.json({ semesters });
  })
);

app.get(
  "/teacher/message/meta/sections",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const { class: className, semester } = req.query;
    const cls = (req.user.class || []).find((c) => c.className === className);
    const sem = cls ? cls.semesters.find((s) => s.semester === semester) : null;
    const sections = sem ? sem.sections.map((s) => s.section) : [];
    res.json({ sections });
  })
);

app.get(
  "/teacher/message/student/search",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json({ students: [] });

    const combos = teacherAssignedCombos(req.user);
    if (!combos.length) return res.json({ students: [] });

    const query = q.trim();
    const isNumeric = /^\d+$/.test(query);

    // 🔒 Sirf apni assigned class/sem/section ke students hi search results me aayenge
    const students = await Student.find({
      status: "Active",
      $and: [
        { $or: combos.map((c) => ({ class: c.class, semester: c.semester, section: c.section })) },
        { $or: [{ name: { $regex: query, $options: "i" } }, ...(isNumeric ? [{ rollNo: Number(query) }] : [])] },
      ],
    })
      .select("name rollNo class semester section")
      .limit(15);

    res.json({ students });
  })
);

// ================= TEACHER — NOTIFICATIONS =================
app.get(
  "/teacher/notifications/unread-count",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    const count = await Notification.countDocuments({
      recipientId: req.user._id,
      recipientRole: "Teacher",
      isRead: false,
    });
    res.json({ count });
  })
);

app.post(
  "/teacher/notifications/mark-all-read",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    await Notification.updateMany(
      { recipientId: req.user._id, recipientRole: "Teacher", isRead: false },
      { $set: { isRead: true } }
    );
    res.json({ success: true });
  })
);


// #########################################################################
// SECTION E — STUDENT ROUTES  (/student/message/...)
// #########################################################################

// ================= STUDENT — INBOX (received: broadcast + individual) =================
app.get(
  "/student/message",
  verifySession,
  isStudentVerified,
  WrapAsync(async (req, res) => {
    const student = req.user;
    const settings = await MessageSettings.getSettings();

    const messages = await Message.find({
      recipientRole: "Student",
      isDeleted: false,
      $or: [
        { audienceType: "all" },
        {
          audienceType: "filter",
          "filter.class": student.class,
          "filter.semester": student.semester,
          "filter.section": student.section,
        },
        { audienceType: "individual", recipientId: student._id },
      ],
    }).sort({ createdAt: -1 });

    res.render("student/messages/index.ejs", { messages, canReply: settings.allowStudentReply });
  })
);

// ================= STUDENT — REPLY (admin permission se gated) =================
app.post(
  "/student/message/:id/reply",
  verifySession,
  isStudentVerified,
  WrapAsync(async (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) {
      req.flash("error", "Reply cannot be empty.");
      return res.redirect("back");
    }

    // 🔒 ADMIN-CONTROLLED PERMISSION GATE
    const settings = await MessageSettings.getSettings();
    if (!settings.allowStudentReply) {
      req.flash("error", "Reply is currently disabled by administrator.");
      return res.redirect("back");
    }

    const parent = await Message.findById(req.params.id);
    if (!parent || parent.isDeleted) {
      req.flash("error", "Original message not found.");
      return res.redirect("back");
    }

    // 🔒 Student sirf apne aap ko ya apni class/sem/section ko bheje gaye
    //     ya "all" broadcast message par hi reply kar sake
    const isAddressedToThisStudent =
      (parent.audienceType === "individual" && String(parent.recipientId) === String(req.user._id)) ||
      parent.audienceType === "all" ||
      (parent.audienceType === "filter" &&
        parent.filter.class === req.user.class &&
        parent.filter.semester === req.user.semester &&
        parent.filter.section === req.user.section);

    if (!isAddressedToThisStudent) {
      req.flash("error", "You cannot reply to this message.");
      return res.redirect("back");
    }

    const reply = await Message.create({
      sender: { id: req.user._id, role: "Student", name: req.user.name },
      recipientRole: parent.sender.role,
      audienceType: "individual",
      recipientId: parent.sender.id,
      content: content.trim(),
      parentMessage: parent._id,
      isReply: true,
    });

    await dispatchReplyNotification(reply, parent.sender.role, parent.sender.id);

    req.flash("success", "Reply sent.");
    return res.redirect("back");
  })
);

// ================= STUDENT — NOTIFICATIONS =================
app.get(
  "/student/notifications/unread-count",
  verifySession,
  isStudentVerified,
  WrapAsync(async (req, res) => {
    const count = await Notification.countDocuments({
      recipientId: req.user._id,
      recipientRole: "Student",
      isRead: false,
    });
    res.json({ count });
  })
);

app.post(
  "/student/notifications/mark-all-read",
  verifySession,
  isStudentVerified,
  WrapAsync(async (req, res) => {
    await Notification.updateMany(
      { recipientId: req.user._id, recipientRole: "Student", isRead: false },
      { $set: { isRead: true } }
    );
    res.json({ success: true });
  })
);


// #########################################################################
// SECTION F — server.listen()  (SABSE NEECHE, file ke end me)
// #########################################################################

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server + Socket.io running on port ${PORT}`);
});

// ⚠️ Agar tere original file me kahin "app.listen(...)" already likha hai,
// usse HATA dena — ab sirf "server.listen(...)" chalega, dono nahi.
