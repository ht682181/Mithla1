if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}
const express = require("express");
 

// const http = require("http");
// const socketIo = require("socket.io");

const app = express();
// const server = http.createServer(app);
// const io = socketIo(server);

const mongoose = require("mongoose");
const ExpressError = require("./utils/ExpressError.js");
const WrapAsync = require("./utils/WrapAsync.js");
const syncStudentDetails = require("./utils/syncStudent.js");
const path = require("path");
const ejsmate = require("ejs-mate");
const methodOverride = require("method-override");

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

const nodemailer = require("nodemailer");
const AttendenceDuplicate = require("./models/attenDanceDuplicate.js");
const Student = require("./models/studentData.js");
const Teacher = require("./models/teacherRecord.js");
const Admin = require("./models/adminSchema.js");
const Subject = require("./models/subjectData.js");
const Class = require("./models/classRecord.js");
const Attendance = require("./models/attendanceRecord.js");
const OTP = require("./models/otp.js");
const Feed = require("./models/feed.js");
const Marks = require("./models/marksData.js");
const ExamConfig = require("./models/examData.js");
const {
  verifySession, isStudentVerified,
 isLoggedIn,
  isAdminVerified,
} = require("./middleware.js");
// const PDFDocument = require("pdfkit");
const PDFDocument = require("pdfkit-table");
const pdf = require("html-pdf-node");
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const flash = require("connect-flash");
const passport = require("passport");
const localStrategy = require("passport-local");
const dayjs = require("dayjs"); /////// date filter
const utc = require("dayjs/plugin/utc"); /////// date filter
dayjs.extend(utc);
const normalizeDate = require("./utils/normalizeDate.js");

const StudentArchive = require("./models/studentArchive.js");
const Section = require("./models/section.js");


const validateTeacher = require("./schema/teacherSchema.js");
const validateTeacherEdit = require("./schema/editTeacherSchema.js");
const validateStudent = require("./schema/studentSchema.js");
const validateClass = require("./schema/classSchema.js");
const validateSubject = require("./schema/subjectSchema.js");
const validateAssignStudent = require("./schema/assignStudent.js");
const validateAssignTeacher = require("./schema/assignTeacher.js");
const validateFeed = require("./schema/feedSchema.js");
const validateFeeData = require("./schema/validateFeeData.js");
const validateBulkPayments = require("./schema/validateBulkPayment.js");
const {
  validateMarksSetup,
  validateSaveMarks,
} = require("./schema/marksSchema.js");

const {
  validateUpdateMarks,
  validateUpdateExam,
} = require("./schema/editMarkSchema.js");
const {
  preventUnauthorizedAPICalls,
  ADMIN_PASSWORD,
} = require("./schema/preventUnauthorizedAPICalls.js");


const xlsx = require("xlsx");
const AttendanceArchive = require("./models/attendanceArchive.js");
const TimeTable = require("./models/TimeTable.js");
const { FeeLedger, FeeTransaction } = require("./models/feesRecord.js");

// -----------------------------------------FIX UPLOAD-----------------------------------------------------

const cloudinary = require('cloudinary').v2;
const multer = require("multer");
const { storage } = require("./cloudStorage.js");

const storageMemory = multer.memoryStorage();
const uploadBuffer = multer({ storage: storageMemory });



// MIME TYPE MAP FOR ALLOWED ATTACHMENTS
const MIME_TYPE_MAP = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
};


// Single, Production-Ready Multer Upload Middleware
const upload = multer({
  storage: storage, // Cloudinary Storage Use Ho Raha Hai
  limits: { fileSize: 30 * 1024 * 1024 }, // 10MB Limit
  fileFilter: (req, file, cb) => {
    if (MIME_TYPE_MAP[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file format. Allowed: Images, PDF, Word, Excel, PPT."));
    }
  },
});




//---------------------------delete raw data(image,pdf etc...) from cloud----------------------------------

// Helper Function: Handles both Images & Documents in Cloudinary
const deleteFilesFromCloud = async (attachments = []) => {
  if (!attachments || attachments.length === 0) return;

  try {
    const deletePromises = attachments.map(async (item) => {
      if (!item) return null;

      const public_id = typeof item === "string" ? item : item.public_id;
      if (!public_id) return null;

      // Detect if file is an image or non-image document
      let isImage = false;
      if (typeof item === "object") {
        if (item.fileType === "image") isImage = true;
        else if (item.originalMime && item.originalMime.startsWith("image/")) isImage = true;
      } else if (/\.(jpg|jpeg|png|webp|gif)$/i.test(public_id)) {
        isImage = true;
      }

      // 1. Agar Image hai -> Direct Image delete call
      if (isImage) {
        const res = await cloudinary.uploader.destroy(public_id, { resource_type: "image" });
        if (res.result === "ok") return res;
      }

      // 2. Agar Document (PDF, DOCX, XLSX, PPTX) hai -> Raw resource_type handle karo
      // Try 1: Public ID as-is with raw type
      let rawRes = await cloudinary.uploader.destroy(public_id, { resource_type: "raw" });
      if (rawRes.result === "ok") return rawRes;

      // Try 2: Raw files often require extension (e.g. filename.pdf / filename.xlsx)
      if (typeof item === "object" && item.filename && !public_id.includes(".")) {
        const ext = item.filename.split(".").pop();
        if (ext) {
          rawRes = await cloudinary.uploader.destroy(`${public_id}.${ext}`, { resource_type: "raw" });
          if (rawRes.result === "ok") return rawRes;
        }
      }

      // Try 3: Fallback check image resource type for PDFs (in case Cloudinary generated image preview)
      return await cloudinary.uploader.destroy(public_id, { resource_type: "image" });
    });

    await Promise.allSettled(deletePromises);
  } catch (err) {
    console.error("Cloud storage deletion error:", err);
  }
};


//|-----------------------------------------------------------------------------------------------------|

// ------------------ MongoStore + Session Setup ------------------

const session = require("express-session");
const MongoStore = require("connect-mongo");
const dbUrl = process.env.ATLASDB_URL;

const dns = require("dns");

// Google Public DNS set karein SRV lookup ke liye
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const store = MongoStore.create({
  mongoUrl: dbUrl,
  collectionName: "sessions",
  touchAfter: 24 * 3600, // 1 day
});

store.on("error", (err) => {
  console.log("SESSION STORE ERROR:", err);
});

const sessionOptions = {
  secret: process.env.SECRET,
  store,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
  },
};





app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "/public")));
app.use(methodOverride("_method"));
app.engine("ejs", ejsmate);


const sessionMiddleware = session(sessionOptions);
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new localStrategy(Teacher.authenticate()));

passport.serializeUser(Teacher.serializeUser());
passport.deserializeUser(Teacher.deserializeUser());

app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.curruser = req.user;
  next();
});

// ------------------ Mongoose Connection ------------------

async function main() {
  await mongoose.connect(dbUrl);
}

main()
  .then(() => console.log("MongoDB Connected Successfully ✔"))
  .catch((err) => console.log("MongoDB Error ❌", err));


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

// async function dispatchReplyNotification(replyMessage, originalSenderRole, originalSenderId) {
//   const title = `${replyMessage.sender.name} replied to your message`;
//   const preview = replyMessage.content.slice(0, 120);

//   await Notification.create({
//     recipientId: originalSenderId,
//     recipientRole: originalSenderRole,
//     message: replyMessage._id,
//     title,
//     preview,
//     isDelivered: true,
//   });

//   io.to(roomForUser(originalSenderRole, originalSenderId)).emit("new-reply", serializeForEmit(replyMessage));
// }




// Helper function to dispatch reply notification
async function dispatchReplyNotification(replyMessage, originalSenderRole, originalSenderId, session = null) {
  if (!originalSenderId || !originalSenderRole) return;

  const title = `${replyMessage.sender?.name || "Admin"} replied to your message`;
  const preview = replyMessage.content ? replyMessage.content.slice(0, 120) : "";

  const notificationOptions = session ? { session } : {};

  await Notification.create(
    [
      {
        recipientId: originalSenderId,
        recipientRole: originalSenderRole,
        message: replyMessage._id,
        title,
        preview,
        isDelivered: true,
      },
    ],
    notificationOptions
  );

  if (global.io) {
    global.io.to(roomForUser(originalSenderRole, originalSenderId)).emit("new-reply", serializeForEmit(replyMessage));
  }
}


// #########################################################################
// SECTION C — ADMIN ROUTES  (/admin/message/...)
// #########################################################################

// GET: COMPOSE FORM FOR STUDENT MESSAGES
app.get(
  "/admin/message/student/compose",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const classes = await Student.distinct("class", { status: "Active" });
    res.render("admin/messages/compose-student.ejs", { classes });
  })
);

// GET: METADATA API
app.get(
  "/admin/message/meta/students-by-filter",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { class: className, semester, section } = req.query;
    if (!className || !semester || !section) {
      return res.json({ students: [] });
    }
    const students = await Student.find({
      status: "Active",
      class: className,
      semester,
      section,
    })
      .select("_id name rollNo class semester section fatherName")
      .sort({ rollNo: 1, name: 1 });

    res.json({ students });
  })
);

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

// POST: DISPATCH STUDENT MESSAGES
app.post(
  "/admin/message/student",
  verifySession,
  isAdminVerified,
  (req, res, next) => {
    // Handling Multer error gracefully before hitting async route handler
    upload.array("attachments", 5)(req, res, (err) => {
      if (err) {
        req.flash("error", err.message || "File upload failed.");
        return res.redirect("/admin/message/student/compose");
      }
      next();
    });
  },
  WrapAsync(async (req, res) => {
    let { audienceType, class: className, semester, section, studentIds, content } = req.body;

    if (studentIds && !Array.isArray(studentIds)) {
      studentIds = [studentIds];
    }

    if ((!content || !content.trim()) && (!req.files || req.files.length === 0)) {
      req.flash("error", "Message content or at least one attachment is required.");
      return res.redirect("/admin/message/student/compose");
    }

    // Process File Attachments
    const attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileType = MIME_TYPE_MAP[file.mimetype] || "document";
        attachments.push({
          url: file.path,
          public_id: file.filename || file.public_id || null, // Capture cloud public_id
          filename: file.originalname,
          fileType: fileType,
          originalMime: file.mimetype,
        });
      }
    }

    const createdMessages = [];
    const dbSession = await mongoose.startSession();

    try {
      // 4. FIXED: DATABASE TRANSACTION ONLY HANDLES MONGO CREATION
      await dbSession.withTransaction(async () => {
        if (audienceType === "all") {
          const [message] = await Message.create(
            [
              {
                sender: { id: req.user._id, role: "Admin", name: req.user.name },
                recipientRole: "Student",
                audienceType: "all",
                content: content ? content.trim() : "",
                attachments,
              },
            ],
            { session: dbSession }
          );
          createdMessages.push(message);
        } else if (audienceType === "filter") {
          if (!className || !semester || !section) {
            throw new Error("Class, Semester, and Section are required for targeted messages.");
          }
          const [message] = await Message.create(
            [
              {
                sender: { id: req.user._id, role: "Admin", name: req.user.name },
                recipientRole: "Student",
                audienceType: "filter",
                filter: { class: className, semester, section },
                content: content ? content.trim() : "",
                attachments,
              },
            ],
            { session: dbSession }
          );
          createdMessages.push(message);
        } else if (audienceType === "individual") {
          if (!studentIds || studentIds.length === 0) {
            throw new Error("Please select at least one student from the list.");
          }

          for (const sId of studentIds) {
            const [message] = await Message.create(
              [
                {
                  sender: { id: req.user._id, role: "Admin", name: req.user.name },
                  recipientRole: "Student",
                  audienceType: "individual",
                  recipientId: sId,
                  content: content ? content.trim() : "",
                  attachments,
                },
              ],
              { session: dbSession }
            );
            createdMessages.push(message);
          }
        } else {
          throw new Error("Invalid audience mode selected.");
        }
      });

      // 4. FIXED: SOCKET / PUSH NOTIFICATIONS FIRED AFTER DB TRANSACTION IS COMMITTED
      Promise.allSettled(
        createdMessages.map((msg) => dispatchMessageNotification(msg))
      ).catch((err) => console.error("Notification dispatch error:", err));

      req.flash("success", "Message(s) dispatched successfully!");
      res.redirect("/admin/message/student/sent");
    } catch (err) {
      req.flash("error", err.message || "Failed to dispatch message.");
      res.redirect("/admin/message/student/compose");
    } finally {
      dbSession.endSession();
    }
  })
);



// Helper function to safely execute DB actions (Supports Standalone & Replica Sets)
async function safeTransaction(actionCallback) {
  let session = null;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      result = await actionCallback(session);
    });
    return result;
  } catch (err) {
    if (err.message && err.message.includes("Transaction numbers are only allowed on a replica set member")) {
      return await actionCallback(null);
    }
    throw err;
  } finally {
    if (session) session.endSession();
  }
}

// Utility to escape Special Characters for Regex Search Safety
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

// Helper function to escape regex characters safely
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

// Build Active Query Helper (Fixed for Student Name & RollNo Search)
async function buildActiveQuery(userId, selectedScope, searchQuery, showArchived) {
  const baseQuery = {
    "sender.id": userId,
    "sender.role": "Admin",
    recipientRole: "Student",
    isDeleted: showArchived === true || showArchived === "true",
  };

  const activeQuery = { ...baseQuery };

  // 1. Scope Filter Logic
  if (selectedScope.startsWith("CLASS_")) {
    activeQuery["audienceType"] = "filter";
    activeQuery["filter.class"] = selectedScope.replace("CLASS_", "");
  } else if (selectedScope === "INDIVIDUAL") {
    activeQuery["audienceType"] = "individual";
  }

  // 2. Search Filter Logic
  if (searchQuery && searchQuery.trim() !== "") {
    const safeSearch = escapeRegex(searchQuery.trim());
    const searchRegex = new RegExp(safeSearch, "i");

    const Student = mongoose.model("Student");

    // Fix: RollNo string or number dono ko handling ke liye $expr / $or conditions
    const studentSearchConditions = [{ name: searchRegex }];

    // Agar user ne pure numbers ya partial numbers (jaise 62, 062) enter kiye hain
    const numSearch = Number(searchQuery.trim());
    if (!isNaN(numSearch)) {
      studentSearchConditions.push({ rollNo: numSearch });
    }

    // String regex match on rollNo via Mongoose $expr ($toString)
    studentSearchConditions.push({
      $expr: {
        $regexMatch: {
          input: { $toString: { $ifNull: ["$rollNo", ""] } },
          regex: safeSearch,
          options: "i",
        },
      },
    });

    // Student model se sabhi matched IDs nikalo
    const matchingStudents = await Student.find({
      $or: studentSearchConditions,
    }).select("_id");

    const matchingStudentIds = matchingStudents.map((s) => s._id);

    // Final Message Query Filter
    activeQuery["$or"] = [
      { content: searchRegex },
      { recipientId: { $in: matchingStudentIds } }, // Yahan 'aman' ya '62' wale saare students match honge!
      { "filter.class": searchRegex },
      { "filter.section": searchRegex },
      { "filter.semester": searchRegex },
      { "subjectContext.subjectName": searchRegex },
    ];
  }

  return activeQuery;
}
// ================= LIVE SEARCH API ENDPOINT =================
app.get(
  "/admin/message/student/api/search",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 40;
    const skip = (page - 1) * limit;
    const selectedScope = req.query.scope || "ALL";
    const searchQuery = (req.query.q || "").trim();
    const showArchived = req.query.view === "archived";

    const activeQuery = await buildActiveQuery(req.user._id, selectedScope, searchQuery, showArchived);

    const totalMessages = await Message.countDocuments(activeQuery);
    const totalPages = Math.ceil(totalMessages / limit) || 1;

    const studentMessages = await Message.find(activeQuery)
      .populate("recipientId", "name rollNo class semester section")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      studentMessages,
      currentPage: page,
      totalPages,
      totalMessages,
    });
  })
);

// ================= ADMIN -> STUDENT (Sent List Page) =================
app.get(
  "/admin/message/student/sent",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 40;
    const skip = (page - 1) * limit;
    const selectedScope = req.query.scope || "ALL";
    const searchQuery = (req.query.q || "").trim();
    const showArchived = req.query.view === "archived";

    const activeQuery = await buildActiveQuery(req.user._id, selectedScope, searchQuery, showArchived);

    const distinctClasses = await Message.distinct("filter.class", {
      "sender.id": req.user._id,
      "sender.role": "Admin",
      recipientRole: "Student",
    });

    const totalMessages = await Message.countDocuments(activeQuery);
    const totalPages = Math.ceil(totalMessages / limit) || 1;

    const studentMessages = await Message.find(activeQuery)
      .populate("recipientId", "name rollNo class semester section fatherName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.render("admin/messages/sent-student.ejs", {
      studentMessages,
      availableClasses: distinctClasses.filter(Boolean),
      selectedScope,
      searchQuery,
      showArchived,
      currentPage: page,
      totalPages,
      totalMessages,
    });
  })
);



// ================= DELETE BULK =================
app.delete(
  "/admin/message/student/bulk-delete",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { ids, type } = req.body;
    const deleteType = type || "soft";

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "No valid message IDs provided." });
    }

    if (ids.length > 1000) {
      return res.status(400).json({ success: false, message: "Cannot process more than 1000 items at once." });
    }

    const query = {
      _id: { $in: ids },
      "sender.id": req.user._id,
      "sender.role": "Admin",
    };

    // Remove files from Cloud Storage if Hard Delete
    if (deleteType === "hard") {
      const messagesToDelete = await Message.find(query).select("attachments");
      const cloudIds = messagesToDelete
        .flatMap((msg) => msg.attachments || [])
        .map((att) => att.public_id)
        .filter(Boolean);

      await deleteFilesFromCloud(cloudIds);
    }

    await safeTransaction(async (session) => {
      if (deleteType === "hard") {
        await Message.deleteMany(query, { session });
      } else {
        await Message.updateMany(
          query,
          { $set: { isDeleted: true, deletedAt: new Date() } },
          { session }
        );
      }
    });

    req.flash("success", `${ids.length} message(s) processed successfully.`);
    res.json({ success: true, message: "Bulk operation successful." });
  })
);
// ================= CLEAR ENTIRE ARCHIVE =================
app.delete(
  "/admin/message/student/clear-archive",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const archiveQuery = {
      "sender.id": req.user._id,
      "sender.role": "Admin",
      recipientRole: "Student",
      isDeleted: true,
    };

    // Find archived messages and delete attachments from Cloud
    const archivedMessages = await Message.find(archiveQuery).select("attachments");
    const cloudIds = archivedMessages
      .flatMap((msg) => msg.attachments || [])
      .map((att) => att.public_id)
      .filter(Boolean);

    await deleteFilesFromCloud(cloudIds);

    await safeTransaction(async (session) => {
      await Message.deleteMany(archiveQuery, { session });
    });

    req.flash("success", "Archive cleared completely.");
    res.json({ success: true, message: "Archive cleared." });
  })
);



// ================= EDIT / UPDATE MESSAGE =================
app.put(
  "/admin/message/student/:id",
  verifySession,
  isAdminVerified,
  (req, res, next) => {
    upload.array("attachments", 5)(req, res, (err) => {
      if (err) {
        req.flash("error", err.message || "File upload failed.");
        return res.redirect("/admin/message/student/sent");
      }
      next();
    });
  },
  WrapAsync(async (req, res) => {
    const { content, removedAttachments } = req.body;
    const trimmedContent = (content || "").trim();

    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) {
      return res.status(404).json({ success: false, message: "Message not found or deleted." });
    }

    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Unauthorized action." });
    }

    // Process attachments to remove
    let toRemove = [];
    if (removedAttachments) {
      try {
        toRemove = typeof removedAttachments === "string" ? JSON.parse(removedAttachments) : removedAttachments;
      } catch (e) {
        toRemove = [removedAttachments];
      }
    }

    // Collect public_ids and filter remaining attachments
    const filesToDeleteFromCloud = [];
    const remainingAttachments = message.attachments.filter((att) => {
      const isRemoved = toRemove.includes(att.url) || toRemove.includes(att.public_id);
      if (isRemoved) {
        if (att.public_id) filesToDeleteFromCloud.push(att.public_id);
      }
      return !isRemoved;
    });

    const files = req.files || [];

    if (!trimmedContent && remainingAttachments.length === 0 && files.length === 0) {
      return res.status(400).json({ success: false, message: "Message must contain text or attachments." });
    }

    // Prepare new attachments
    const newAttachments = files.map((file) => {
      const isImage = file.mimetype.startsWith("image/");
      return {
        url: file.path || `/uploads/${file.filename}`,
        public_id: file.filename || file.public_id || null,
        filename: file.originalname,
        fileType: isImage ? "image" : "document",
        originalMime: file.mimetype,
      };
    });

    // Clean removed attachments from Cloud Storage
    if (filesToDeleteFromCloud.length > 0) {
      await deleteFilesFromCloud(filesToDeleteFromCloud);
    }

    await safeTransaction(async (session) => {
      message.content = trimmedContent;
      message.attachments = [...remainingAttachments, ...newAttachments];
      message.isEdited = true;
      message.editedAt = new Date();
      await message.save({ session });
    });

    req.flash("success", "Message updated successfully.");
    res.json({ success: true, message: "Message updated successfully." });
  })
);



// ================= DELETE SINGLE (SOFT vs HARD) =================
app.delete(
  "/admin/message/student/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const deleteType = req.query.type || "soft";
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Unauthorized action." });
    }

    // If Hard Delete, remove files from cloud storage
    if (deleteType === "hard" && message.attachments && message.attachments.length > 0) {
      const cloudIds = message.attachments.map((att) => att.public_id).filter(Boolean);
      await deleteFilesFromCloud(cloudIds);
    }

    await safeTransaction(async (session) => {
      if (deleteType === "hard") {
        await Message.deleteOne({ _id: req.params.id }, { session });
      } else {
        message.isDeleted = true;
        message.deletedAt = new Date();
        await message.save({ session });
      }
    });

    req.flash("success", `Message ${deleteType === "hard" ? "permanently deleted" : "archived"}.`);
    res.json({ success: true, message: "Operation completed successfully." });
  })
);



// // ================= DELETE BULK =================
// app.delete(
//   "/admin/message/student/bulk-delete",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { ids, type } = req.body;
//     const deleteType = type || "soft";

//     if (!ids || !Array.isArray(ids) || ids.length === 0) {
//       return res.status(400).json({ success: false, message: "No valid message IDs provided." });
//     }

//     if (ids.length > 1000) {
//       return res.status(400).json({ success: false, message: "Cannot process more than 1000 items at once." });
//     }

//     await safeTransaction(async (session) => {
//       const query = {
//         _id: { $in: ids },
//         "sender.id": req.user._id,
//         "sender.role": "Admin",
//       };

//       if (deleteType === "hard") {
//         await Message.deleteMany(query, { session });
//       } else {
//         await Message.updateMany(
//           query,
//           { $set: { isDeleted: true, deletedAt: new Date() } },
//           { session }
//         );
//       }
//     });

//     req.flash("success", `${ids.length} message(s) processed successfully.`);
//     res.json({ success: true, message: "Bulk operation successful." });
//   })
// );

// // ================= CLEAR ENTIRE ARCHIVE =================
// app.delete(
//   "/admin/message/student/clear-archive",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     await safeTransaction(async (session) => {
//       await Message.deleteMany(
//         {
//           "sender.id": req.user._id,
//           "sender.role": "Admin",
//           recipientRole: "Student",
//           isDeleted: true,
//         },
//         { session }
//       );
//     });

//     req.flash("success", "Archive cleared completely.");
//     res.json({ success: true, message: "Archive cleared." });
//   })
// );


// app.put(
//   "/admin/message/student/:id",
//   verifySession,
//   isAdminVerified,
//   (req, res, next) => {
//     // Handling Multer error gracefully before hitting async route handler
//     upload.array("attachments", 5)(req, res, (err) => {
//       if (err) {
//         req.flash("error", err.message || "File upload failed.");
//         return res.redirect("/admin/message/student/sent");
//       }
//       next();
//     });
//   },
//   WrapAsync(async (req, res) => {
//     const { content, removedAttachments } = req.body;
//     const trimmedContent = (content || "").trim();

//     const message = await Message.findById(req.params.id);
//     if (!message || message.isDeleted) {
//       return res.status(404).json({ success: false, message: "Message not found or deleted." });
//     }

//     if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
//       return res.status(403).json({ success: false, message: "Unauthorized action." });
//     }

//     // Validation: Require either text or attachment
//     const files = req.files || [];
//     let toRemove = [];
//     if (removedAttachments) {
//       try {
//         toRemove = typeof removedAttachments === "string" ? JSON.parse(removedAttachments) : removedAttachments;
//       } catch (e) {
//         toRemove = [removedAttachments];
//       }
//     }

//     const remainingAttachments = message.attachments.filter(
//       (att) => !toRemove.includes(att.url)
//     );

//     if (!trimmedContent && remainingAttachments.length === 0 && files.length === 0) {
//       return res.status(400).json({ success: false, message: "Message must contain text or attachments." });
//     }

//     // Prepare new attachments from uploaded files
//     const newAttachments = files.map((file) => {
//       const isImage = file.mimetype.startsWith("image/");
//       return {
//         url: file.path || `/uploads/${file.filename}`, // Adjust as per your cloud/local storage setup
//         filename: file.originalname,
//         fileType: isImage ? "image" : "document",
//         originalMime: file.mimetype,
//       };
//     });

//     await safeTransaction(async (session) => {
//       message.content = trimmedContent;
//       message.attachments = [...remainingAttachments, ...newAttachments];
//       message.isEdited = true;
//       message.editedAt = new Date();
//       await message.save({ session });
//     });

//     req.flash("success", "Message updated successfully.");
//     res.json({ success: true, message: "Message updated successfully." });
//   })
// );

// // ================= DELETE SINGLE (SOFT vs HARD) =================
// app.delete(
//   "/admin/message/student/:id",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const deleteType = req.query.type || "soft";
//     const message = await Message.findById(req.params.id);

//     if (!message) {
//       return res.status(404).json({ success: false, message: "Message not found." });
//     }

//     if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
//       return res.status(403).json({ success: false, message: "Unauthorized action." });
//     }

//     await safeTransaction(async (session) => {
//       if (deleteType === "hard") {
//         await Message.deleteOne({ _id: req.params.id }, { session });
//       } else {
//         message.isDeleted = true;
//         message.deletedAt = new Date();
//         await message.save({ session });
//       }
//     });

//     req.flash("success", `Message ${deleteType === "hard" ? "permanently deleted" : "archived"}.`);
//     res.json({ success: true, message: "Operation completed successfully." });
//   })
// );



// GET Route: Render Active Teachers List (Name & Username/ID Only)
app.get(
  "/admin/message/teacher/compose",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    // Excluded mobile & email to strictly display Name and Username/Emp ID
    const teachers = await Teacher.find({ status: "Active" })
      .select("name username teacherId")
      .sort({ name: 1 });

    res.render("admin/messages/compose-teacher.ejs", { teachers });
  })
);


app.post(
  "/admin/message/teacher",
  verifySession,
  isAdminVerified,
   (req, res, next) => {
    // Handling Multer error gracefully before hitting async route handler
    upload.array("attachments", 5)(req, res, (err) => {
      if (err) {
        req.flash("error", err.message || "File upload failed.");
        return res.redirect("/admin/message/teacher/compose");
      }
      next();
    });
  },
  WrapAsync(async (req, res) => {
    let { audienceType, teacherIds, content } = req.body;

    if (teacherIds && !Array.isArray(teacherIds)) {
      teacherIds = [teacherIds];
    }

    // Validation: Text OR File required
    if ((!content || !content.trim()) && (!req.files || req.files.length === 0)) {
      req.flash("error", "Message content or at least one file attachment is required.");
      return res.redirect("/admin/message/teacher/compose");
    }

    // if(content||content.trim()>2000){
    //   req.flash("error","Message is greater than 2000 character");
    //   return res.redirect("/admin/message/teacher/compose")
    // }

    // Process File Attachments
    const attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileType = MIME_TYPE_MAP[file.mimetype] || "document";
        attachments.push({
          url: file.path,
           public_id: file.filename || file.public_id || null,
          filename: file.originalname,
          fileType: fileType,
          originalMime: file.mimetype,
        });
      }
    }

    let teachers = [];
    if (audienceType !== "all") {
      const targetTeacherIds = Array.isArray(teacherIds)
        ? teacherIds.filter(Boolean)
        : [teacherIds].filter(Boolean);

      if (!targetTeacherIds.length) {
        req.flash("error", "Please select at least one teacher.");
        return res.redirect("/admin/message/teacher/compose");
      }

      teachers = await Teacher.find({ _id: { $in: targetTeacherIds }, status: "Active" }).select("_id name");
      if (!teachers.length) {
        req.flash("error", "No active teachers found matching selection.");
        return res.redirect("/admin/message/teacher/compose");
      }
    }

    const createdMessages = [];

    // Safe DB Transaction Execution
    await safeTransaction(async (session) => {
      if (audienceType === "all") {
        // 🟢 FIX 1: Save SINGLE BULK Document for ALL TEACHERS
        const [msg] = await Message.create(
          [
            {
              sender: { id: req.user._id, role: "Admin", name: req.user.name },
              recipientRole: "Teacher",
              audienceType: "all",
              recipientId: null,
              content: content ? content.trim() : "",
              attachments: attachments,
            },
          ],
          { session }
        );
        createdMessages.push(msg);
      } else {
        // 🟢 FIX 2: Save INDIVIDUAL Documents for Specific Teachers
        for (const teacher of teachers) {
          const [msg] = await Message.create(
            [
              {
                sender: { id: req.user._id, role: "Admin", name: req.user.name },
                recipientRole: "Teacher",
                audienceType: "individual",
                recipientId: teacher._id,
                content: content ? content.trim() : "",
                attachments: attachments,
              },
            ],
            { session }
          );
          createdMessages.push(msg);
        }
      }
    });

    // 🟢 FIX 3: Safe Realtime Socket Notification Trigger (Prevents Null Crashes)
    Promise.allSettled(
      createdMessages.map((m) => {
        if (typeof dispatchMessageNotification === "function") {
          return dispatchMessageNotification(m);
        }
        return Promise.resolve();
      })
    ).catch((err) => console.error("Notification dispatch error:", err));

    const successMsg = audienceType === "all"
      ? "Bulk message dispatched to ALL teachers successfully."
      : `Message sent to ${teachers.length} teacher(s) successfully.`;

    req.flash("success", successMsg);
    return res.redirect("/admin/message/teacher/sent");
  })
);

// // ================= ADMIN -> TEACHER (sent list) =================

// // Query Builder Helper
// function buildTeacherMessagesQuery(req) {
//   const showArchived = req.query.view === "archived";
//   const searchQuery = (req.query.q || "").trim();

//   const query = {
//     "sender.id": req.user._id,
//     "sender.role": "Admin",
//     recipientRole: "Teacher",
//     isDeleted: showArchived ? true : false,
//   };

//   return { query, showArchived, searchQuery };
// }

// // 1. GET: Main Sent Page with Pagination
// app.get(
//   "/admin/message/teacher/sent",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const page = Math.max(1, parseInt(req.query.page) || 1);
//     const limit = 10;
//     const skip = (page - 1) * limit;

//     const { query, showArchived, searchQuery } = buildTeacherMessagesQuery(req);

//     let matchQuery = { ...query };

//     if (searchQuery) {
//       const searchRegex = new RegExp(searchQuery, "i");
//       matchQuery.$or = [
//         { content: searchRegex }
//       ];
//     }

//     const totalRecords = await Message.countDocuments(matchQuery);
//     const teacherMessages = await Message.find(matchQuery)
//       .populate("recipientId", "name email")
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit);

//     const totalPages = Math.ceil(totalRecords / limit) || 1;

//     res.render("admin/messages/sent-teacher.ejs", {
//       teacherMessages,
//       showArchived,
//       searchQuery,
//       currentPage: page,
//       totalPages,
//     });
//   })
// );

// // 2. GET: Live API Search Endpoint (DB-Level Search)
// app.get(
//   "/admin/message/teacher/api/search",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const page = Math.max(1, parseInt(req.query.page) || 1);
//     const limit = 20;
//     const skip = (page - 1) * limit;

//     const showArchived = req.query.view === "archived";
//     const searchQuery = (req.query.q || "").trim();

//     const matchStage = {
//       "sender.id": new mongoose.Types.ObjectId(req.user._id),
//       "sender.role": "Admin",
//       recipientRole: "Teacher",
//       isDeleted: showArchived ? true : false,
//     };

//     let pipeline = [
//       { $match: matchStage },
//       {
//         $lookup: {
//           from: "teachers", // Apni DB me Teacher collection ka exact name check kar lein
//           localField: "recipientId",
//           foreignField: "_id",
//           as: "recipientDetails"
//         }
//       },
//       {
//         $unwind: {
//           path: "$recipientDetails",
//           preserveNullAndEmptyArrays: true
//         }
//       }
//     ];

//     if (searchQuery) {
//       const regex = new RegExp(searchQuery, "i");
//       pipeline.push({
//         $match: {
//           $or: [
//             { content: regex },
//             { "recipientDetails.name": regex },
//             { "recipientDetails.email": regex }
//           ]
//         }
//       });
//     }

//     // Count Total Matching Documents
//     const countPipeline = [...pipeline, { $count: "total" }];
//     const countResult = await Message.aggregate(countPipeline);
//     const totalRecords = countResult.length > 0 ? countResult[0].total : 0;

//     // Paginated Data Pipeline
//     pipeline.push({ $sort: { createdAt: -1 } });
//     pipeline.push({ $skip: skip });
//     pipeline.push({ $limit: limit });

//     // Format output to align with view payload
//     pipeline.push({
//       $project: {
//         _id: 1,
//         content: 1,
//         attachments: 1,
//         isEdited: 1,
//         editedAt: 1,
//         isDeleted: 1,
//         createdAt: 1,
//         recipientId: {
//           _id: "$recipientDetails._id",
//           name: "$recipientDetails.name",
//           email: "$recipientDetails.email"
//         }
//       }
//     });

//     const teacherMessages = await Message.aggregate(pipeline);
//     const totalPages = Math.ceil(totalRecords / limit) || 1;

//     res.json({
//       success: true,
//       teacherMessages,
//       currentPage: page,
//       totalPages,
//     });
//   })
// );




// app.put(
//   "/admin/message/teacher/:id",
//   verifySession,
//   isAdminVerified,
//   (req, res, next) => {
//     upload.array("attachments", 5)(req, res, (err) => {
//       if (err) {
//         req.flash("error", err.message || "File upload failed.");
//         return res.redirect("/admin/message/teacher/sent");
//       }
//       next();
//     });
//   },
//   WrapAsync(async (req, res) => {
//     if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
//       return res.status(400).json({ success: false, message: "Invalid message ID format." });
//     }

//     // FIX 1: Content null or undefined protection
//     const rawContent = req.body.content !== undefined ? req.body.content : "";
//     const trimmedContent = String(rawContent).trim();

//     const message = await Message.findById(req.params.id);
//     if (!message || message.isDeleted) {
//       return res.status(404).json({ success: false, message: "Message not found or deleted." });
//     }

//     if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
//       return res.status(403).json({ success: false, message: "Unauthorized action." });
//     }

//     // FIX 2: Dynamic Attachment Removal (Handles JSON String, Normal Array & Path Normalization)
//     let toRemove = [];
//     const rawRemoved = req.body.removedAttachments;

//     if (rawRemoved) {
//       try {
//         toRemove = typeof rawRemoved === "string" ? JSON.parse(rawRemoved) : rawRemoved;
//       } catch (e) {
//         toRemove = [rawRemoved];
//       }
//     }

//     if (!Array.isArray(toRemove)) {
//       toRemove = [toRemove];
//     }

//     // Clean and decode URLs for accurate matching
//     const normalizedToRemove = toRemove.map((url) => decodeURIComponent(String(url).trim()));

//     const remainingAttachments = (message.attachments || []).filter((att) => {
//       const decodedAttUrl = decodeURIComponent(String(att.url || "").trim());
//       // Match by exact decoded URL or filename fallback
//       const isRemoved = normalizedToRemove.some(
//         (remUrl) => remUrl === decodedAttUrl || (att.filename && remUrl.includes(att.filename))
//       );
//       return !isRemoved;
//     });

//     const files = req.files || [];

//     // Validation Check
//     if (!trimmedContent && remainingAttachments.length === 0 && files.length === 0) {
//       return res.status(400).json({ success: false, message: "Message must contain text or attachments." });
//     }

//     // Process new uploads
//     const newAttachments = files.map((file) => {
//       const isImage = file.mimetype.startsWith("image/");
//       return {
//         url: file.path || `/uploads/${file.filename}`,
//         filename: file.originalname,
//         fileType: isImage ? "image" : "document",
//         originalMime: file.mimetype,
//       };
//     });

//     // Save with Atomic Transaction
//     await safeTransaction(async (session) => {
//       message.content = trimmedContent; // Null issue fixed
//       message.attachments = [...remainingAttachments, ...newAttachments]; // Removal fixed
//       message.isEdited = true;
//       message.editedAt = new Date();
//       message.markModified("attachments"); // Explicit Mongoose Array Mutation Signal
//       await message.save({ session });
//     });

//     req.flash("success", "Teacher message updated successfully.");
//     return res.json({ success: true, message: "Teacher message updated successfully." });
//   })
// );

// // 1. Bulk Delete Route
// app.delete(
//   "/admin/message/teacher/bulk-delete",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     let { ids, type } = req.body;

//     if (typeof ids === "string") {
//       try {
//         ids = JSON.parse(ids);
//       } catch (e) {
//         ids = [ids];
//       }
//     }

//     if (!ids || !Array.isArray(ids) || ids.length === 0) {
//       return res.status(400).json({ success: false, message: "No IDs provided." });
//     }

//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//       const filter = {
//         _id: { $in: ids },
//         "sender.id": req.user._id,
//         "sender.role": "Admin",
//         recipientRole: "Teacher",
//       };

//       if (type === "hard") {
//         await Message.deleteMany(filter, { session });
//       } else {
//         await Message.updateMany(
//           filter,
//           { $set: { isDeleted: true, deletedAt: new Date() } },
//           { session }
//         );
//       }

//       await session.commitTransaction();
//       return res.json({ success: true, message: "Bulk operation completed successfully." });
//     } catch (err) {
//       await session.abortTransaction();
//       throw err;
//     } finally {
//       session.endSession(); // Har condition me end hoga
//     }
//   })
// );
// // 4. DELETE: Single Delete (Soft / Hard)
// app.delete(
//   "/admin/message/teacher/:id",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
//       return res.status(400).json({ success: false, message: "Invalid message ID." });
//     }

//     const deleteType = req.query.type || "soft";
//     const message = await Message.findById(req.params.id);

//     if (!message) {
//       return res.status(404).json({ success: false, message: "Message not found." });
//     }

//     if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
//       return res.status(403).json({ success: false, message: "Unauthorized operation." });
//     }

//     if (deleteType === "hard") {
//       await Message.findByIdAndDelete(req.params.id);
//     } else {
//       message.isDeleted = true;
//       message.deletedAt = new Date();
//       await message.save();
//     }

//     return res.json({ success: true, message: "Message deleted successfully." });
//   })
// );

// // 6. DELETE: Clear Archive with Session Transaction
// app.delete(
//   "/admin/message/teacher/clear-archive",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//       await Message.deleteMany(
//         {
//           "sender.id": req.user._id,
//           "sender.role": "Admin",
//           recipientRole: "Teacher",
//           isDeleted: true,
//         },
//         { session }
//       );

//       await session.commitTransaction();
//       session.endSession();

//       return res.json({ success: true, message: "Archive cleared successfully." });
//     } catch (err) {
//       await session.abortTransaction();
//       session.endSession();
//       throw err;
//     }
//   })
// );



// ================= ADMIN -> TEACHER (sent list) =================

// Query Builder Helper
function buildTeacherMessagesQuery(req) {
  const showArchived = req.query.view === "archived";
  const searchQuery = (req.query.q || "").trim();

  const query = {
    "sender.id": req.user._id,
    "sender.role": "Admin",
    recipientRole: "Teacher",
    isDeleted: showArchived ? true : false,
  };

  return { query, showArchived, searchQuery };
}

// 1. GET: Main Sent Page with Pagination (25 per page)
 app.get(
  "/admin/message/teacher/sent",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25; // Fixed pagination to 25 items per page
    const skip = (page - 1) * limit;

    const { query, showArchived, searchQuery } = buildTeacherMessagesQuery(req);

    let matchQuery = { ...query };

    if (searchQuery) {
      const searchRegex = new RegExp(searchQuery, "i");
      matchQuery.$or = [{ content: searchRegex }];
    }

    const totalRecords = await Message.countDocuments(matchQuery);
    const teacherMessages = await Message.find(matchQuery)
      .populate("recipientId", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalRecords / limit) || 1;

    res.render("admin/messages/sent-teacher.ejs", {
      teacherMessages,
      showArchived,
      searchQuery,
      currentPage: page,
      totalPages,
    });
  })
);

// 2. GET: Live API Search Endpoint (DB-Level Search - 25 per page)
 app.get(
  "/admin/message/teacher/api/search",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25; // Fixed pagination to 25 items per page
    const skip = (page - 1) * limit;

    const showArchived = req.query.view === "archived";
    const searchQuery = (req.query.q || "").trim();

    const matchStage = {
      "sender.id": new mongoose.Types.ObjectId(req.user._id),
      "sender.role": "Admin",
      recipientRole: "Teacher",
      isDeleted: showArchived ? true : false,
    };

    let pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: "teachers", // MongoDB collection name for teachers
          localField: "recipientId",
          foreignField: "_id",
          as: "recipientDetails",
        },
      },
      {
        $unwind: {
          path: "$recipientDetails",
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    if (searchQuery) {
      const regex = new RegExp(searchQuery, "i");
      pipeline.push({
        $match: {
          $or: [
            { content: regex },
            { "recipientDetails.name": regex },
            { "recipientDetails.email": regex },
          ],
        },
      });
    }

    // Count Total Matching Documents
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Message.aggregate(countPipeline);
    const totalRecords = countResult.length > 0 ? countResult[0].total : 0;

    // Paginated Data Pipeline
    pipeline.push({ $sort: { createdAt: -1 } });
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    // Format output to align with view payload
    pipeline.push({
      $project: {
        _id: 1,
        content: 1,
        attachments: 1,
        isEdited: 1,
        editedAt: 1,
        isDeleted: 1,
        createdAt: 1,
        recipientId: {
          $cond: {
            if: { $gt: [{ $type: "$recipientDetails._id" }, "missing"] },
            then: {
              _id: "$recipientDetails._id",
              name: "$recipientDetails.name",
              email: "$recipientDetails.email",
            },
            else: null,
          },
        },
      },
    });

    const teacherMessages = await Message.aggregate(pipeline);
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    res.json({
      success: true,
      teacherMessages,
      currentPage: page,
      totalPages,
    });
  })
);

// 3. PUT: Update Teacher Message (Cloud Cleanup -> Then DB Update)
app.put(
  "/admin/message/teacher/:id",
  verifySession,
  isAdminVerified,
  (req, res, next) => {
    upload.array("attachments", 5)(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message || "File upload failed." });
      }
      next();
    });
  },
  WrapAsync(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid message ID format." });
    }

    const rawContent = req.body.content !== undefined ? req.body.content : "";
    const trimmedContent = String(rawContent).trim();

    const message = await Message.findById(req.params.id);
    if (!message || message.isDeleted) {
      return res.status(404).json({ success: false, message: "Message not found or deleted." });
    }

    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Unauthorized action." });
    }

    // Dynamic Attachment Removal Handling
    let toRemove = [];
    const rawRemoved = req.body.removedAttachments;

    if (rawRemoved) {
      try {
        toRemove = typeof rawRemoved === "string" ? JSON.parse(rawRemoved) : rawRemoved;
      } catch (e) {
        toRemove = [rawRemoved];
      }
    }

    if (!Array.isArray(toRemove)) {
      toRemove = [toRemove];
    }

    const normalizedToRemove = toRemove.map((url) => decodeURIComponent(String(url).trim()));

    // 1. Identify removed attachments
    const removedAttachmentsList = [];

    const remainingAttachments = (message.attachments || []).filter((att) => {
      const decodedAttUrl = decodeURIComponent(String(att.url || "").trim());
      const isRemoved = normalizedToRemove.some(
        (remUrl) => remUrl === decodedAttUrl || (att.filename && remUrl.includes(att.filename)) || (att.public_id && remUrl === att.public_id)
      );

      if (isRemoved) {
        removedAttachmentsList.push(att);
      }
      return !isRemoved;
    });

    const files = req.files || [];

    // Validation Check
    if (!trimmedContent && remainingAttachments.length === 0 && files.length === 0) {
      return res.status(400).json({ success: false, message: "Message cannot be completely empty." });
    }

    // Process new uploads with public_id
    const newAttachments = files.map((file) => {
      const isImage = file.mimetype ? file.mimetype.startsWith("image/") : false;
      return {
        url: file.path || `/uploads/${file.filename}`,
        public_id: file.filename || file.public_id || null,
        filename: file.originalname,
        fileType: isImage ? "image" : "document",
        originalMime: file.mimetype,
      };
    });

    // STEP 1: PEHLE CLOUD STORAGE SE DELETE KARO
    if (removedAttachmentsList.length > 0) {
      await deleteFilesFromCloud(removedAttachmentsList);
    }

    // STEP 2: FIR DATABASE ME UPDATE SAVE KARO
    await safeTransaction(async (session) => {
      message.content = trimmedContent;
      message.attachments = [...remainingAttachments, ...newAttachments];
      message.isEdited = true;
      message.editedAt = new Date();
      message.markModified("attachments");
      await message.save({ session });
    });

    return res.json({ success: true, message: "Teacher message updated successfully." });
  })
);

// 4. DELETE: Bulk Delete Route (Cloud First -> Then DB Delete)
app.delete(
  "/admin/message/teacher/bulk-delete",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    let { ids, type } = req.body;

    if (typeof ids === "string") {
      try {
        ids = JSON.parse(ids);
      } catch (e) {
        ids = [ids];
      }
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "No IDs provided." });
    }

    const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return res.status(400).json({ success: false, message: "No valid message IDs provided." });
    }

    const filter = {
      _id: { $in: validIds },
      "sender.id": req.user._id,
      "sender.role": "Admin",
      recipientRole: "Teacher",
    };

    // STEP 1: PEHLE CLOUD STORAGE SE FILES DELETE KARO (HARD DELETE KE WAQT)
    if (type === "hard") {
      const messagesToDelete = await Message.find(filter).select("attachments");
      const attachmentsToDelete = messagesToDelete.flatMap((msg) => msg.attachments || []);
      if (attachmentsToDelete.length > 0) {
        await deleteFilesFromCloud(attachmentsToDelete);
      }
    }

    // STEP 2: FIR DATABASE TRANSACTION EXECUTE KARO
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (type === "hard") {
        await Message.deleteMany(filter, { session });
      } else {
        await Message.updateMany(
          filter,
          { $set: { isDeleted: true, deletedAt: new Date() } },
          { session }
        );
      }

      await session.commitTransaction();
      return res.json({ success: true, message: "Bulk operation completed successfully." });
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  })
);


// 6. DELETE: Clear Archive (Cloud First -> Then DB Wipe)
app.delete(
  "/admin/message/teacher/clear-archive",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const archiveFilter = {
      "sender.id": req.user._id,
      "sender.role": "Admin",
      recipientRole: "Teacher",
      isDeleted: true,
    };

    // STEP 1: PEHLE SARI ARCHIVED CLOUD FILES KO CLEARED KARO
    const archivedMessages = await Message.find(archiveFilter).select("attachments");
    const attachmentsToDelete = archivedMessages.flatMap((msg) => msg.attachments || []);

    if (attachmentsToDelete.length > 0) {
      await deleteFilesFromCloud(attachmentsToDelete);
    }

    // STEP 2: FIR DATABASE SE HARD DELETE KARO
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await Message.deleteMany(archiveFilter, { session });

      await session.commitTransaction();
      session.endSession();

      return res.json({ success: true, message: "Archive cleared successfully." });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  })
);

// 5. DELETE: Single Delete (Cloud First -> Then DB Delete)
app.delete(
  "/admin/message/teacher/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid message ID." });
    }

    const deleteType = req.query.type || "soft";
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Unauthorized operation." });
    }

    // STEP 1: PEHLE CLOUD STORAGE SE ATTACHMENTS DELETE KARO
    if (deleteType === "hard" && message.attachments && message.attachments.length > 0) {
      await deleteFilesFromCloud(message.attachments);
    }

    // STEP 2: FIR DATABASE RECORD DELETE / ARCHIVE KARO
    if (deleteType === "hard") {
      await Message.findByIdAndDelete(req.params.id);
    } else {
      message.isDeleted = true;
      message.deletedAt = new Date();
      await message.save();
    }

    return res.json({ success: true, message: "Message deleted successfully." });
  })
);


// // 3. PUT: Update Teacher Message (Attachment Requirement Removed)
//  app.put(
//   "/admin/message/teacher/:id",
//   verifySession,
//   isAdminVerified,
//   (req, res, next) => {
//     upload.array("attachments", 5)(req, res, (err) => {
//       if (err) {
//         return res.status(400).json({ success: false, message: err.message || "File upload failed." });
//       }
//       next();
//     });
//   },
//   WrapAsync(async (req, res) => {
//     if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
//       return res.status(400).json({ success: false, message: "Invalid message ID format." });
//     }

//     const rawContent = req.body.content !== undefined ? req.body.content : "";
//     const trimmedContent = String(rawContent).trim();

//     const message = await Message.findById(req.params.id);
//     if (!message || message.isDeleted) {
//       return res.status(404).json({ success: false, message: "Message not found or deleted." });
//     }

//     if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
//       return res.status(403).json({ success: false, message: "Unauthorized action." });
//     }

//     // Dynamic Attachment Removal Handling
//     let toRemove = [];
//     const rawRemoved = req.body.removedAttachments;

//     if (rawRemoved) {
//       try {
//         toRemove = typeof rawRemoved === "string" ? JSON.parse(rawRemoved) : rawRemoved;
//       } catch (e) {
//         toRemove = [rawRemoved];
//       }
//     }

//     if (!Array.isArray(toRemove)) {
//       toRemove = [toRemove];
//     }

//     const normalizedToRemove = toRemove.map((url) => decodeURIComponent(String(url).trim()));

//     const remainingAttachments = (message.attachments || []).filter((att) => {
//       const decodedAttUrl = decodeURIComponent(String(att.url || "").trim());
//       const isRemoved = normalizedToRemove.some(
//         (remUrl) => remUrl === decodedAttUrl || (att.filename && remUrl.includes(att.filename))
//       );
//       return !isRemoved;
//     });

//     const files = req.files || [];

//     // Validation Check: Allowed if at least text content OR remaining/new attachments exist
//     if (!trimmedContent && remainingAttachments.length === 0 && files.length === 0) {
//       return res.status(400).json({ success: false, message: "Message cannot be completely empty." });
//     }

//     // Process new uploads
//     const newAttachments = files.map((file) => {
//       const isImage = file.mimetype ? file.mimetype.startsWith("image/") : false;
//       return {
//         url: file.path || `/uploads/${file.filename}`,
//         filename: file.originalname,
//         fileType: isImage ? "image" : "document",
//         originalMime: file.mimetype,
//       };
//     });

//     // Save with Atomic Transaction
//     await safeTransaction(async (session) => {
//       message.content = trimmedContent;
//       message.attachments = [...remainingAttachments, ...newAttachments];
//       message.isEdited = true;
//       message.editedAt = new Date();
//       message.markModified("attachments");
//       await message.save({ session });
//     });

//     return res.json({ success: true, message: "Teacher message updated successfully." });
//   })
// );

// // 4. DELETE: Bulk Delete Route
//  app.delete(
//   "/admin/message/teacher/bulk-delete",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     let { ids, type } = req.body;

//     if (typeof ids === "string") {
//       try {
//         ids = JSON.parse(ids);
//       } catch (e) {
//         ids = [ids];
//       }
//     }

//     if (!ids || !Array.isArray(ids) || ids.length === 0) {
//       return res.status(400).json({ success: false, message: "No IDs provided." });
//     }

//     const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
//     if (validIds.length === 0) {
//       return res.status(400).json({ success: false, message: "No valid message IDs provided." });
//     }

//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//       const filter = {
//         _id: { $in: validIds },
//         "sender.id": req.user._id,
//         "sender.role": "Admin",
//         recipientRole: "Teacher",
//       };

//       if (type === "hard") {
//         await Message.deleteMany(filter, { session });
//       } else {
//         await Message.updateMany(
//           filter,
//           { $set: { isDeleted: true, deletedAt: new Date() } },
//           { session }
//         );
//       }

//       await session.commitTransaction();
//       return res.json({ success: true, message: "Bulk operation completed successfully." });
//     } catch (err) {
//       await session.abortTransaction();
//       throw err;
//     } finally {
//       session.endSession();
//     }
//   })
// );

// // 5. DELETE: Single Delete (Soft / Hard)
//  app.delete(
//   "/admin/message/teacher/:id",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
//       return res.status(400).json({ success: false, message: "Invalid message ID." });
//     }

//     const deleteType = req.query.type || "soft";
//     const message = await Message.findById(req.params.id);

//     if (!message) {
//       return res.status(404).json({ success: false, message: "Message not found." });
//     }

//     if (String(message.sender.id) !== String(req.user._id) || message.sender.role !== "Admin") {
//       return res.status(403).json({ success: false, message: "Unauthorized operation." });
//     }

//     if (deleteType === "hard") {
//       await Message.findByIdAndDelete(req.params.id);
//     } else {
//       message.isDeleted = true;
//       message.deletedAt = new Date();
//       await message.save();
//     }

//     return res.json({ success: true, message: "Message deleted successfully." });
//   })
// );

// // 6. DELETE: Clear Archive
//  app.delete(
//   "/admin/message/teacher/clear-archive",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//       await Message.deleteMany(
//         {
//           "sender.id": req.user._id,
//           "sender.role": "Admin",
//           recipientRole: "Teacher",
//           isDeleted: true,
//         },
//         { session }
//       );

//       await session.commitTransaction();
//       session.endSession();

//       return res.json({ success: true, message: "Archive cleared successfully." });
//     } catch (err) {
//       await session.abortTransaction();
//       session.endSession();
//       throw err;
//     }
//   })
// );


// // ================= ADMIN — RECEIVED (replies from teachers/students) =================
// app.get(
//   "/admin/message/received",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const receivedMessages = await Message.find({
//       recipientRole: "Admin",
//       recipientId: req.user._id,
//       isDeleted: false,
//     }).sort({ createdAt: -1 });

//     res.render("admin/messages/received.ejs", { receivedMessages });
//   })
// );

// // ================= ADMIN — REPLY (only to messages addressed to this admin) =================
// app.post(
//   "/admin/message/:id/reply",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { content } = req.body;
//     if (!content || !content.trim()) {
//       req.flash("error", "Reply cannot be empty.");
//       return res.redirect("back");
//     }

//     const parent = await Message.findById(req.params.id);
//     if (!parent || parent.isDeleted) {
//       req.flash("error", "Original message not found.");
//       return res.redirect("back");
//     }

//     // 🔒 Admin sirf apne-aap ko bheje gaye message par reply kar sakta hai
//     if (parent.recipientRole !== "Admin" || String(parent.recipientId) !== String(req.user._id)) {
//       req.flash("error", "You cannot reply to this message.");
//       return res.redirect("back");
//     }

//     const reply = await Message.create({
//       sender: { id: req.user._id, role: "Admin", name: req.user.name },
//       recipientRole: parent.sender.role,
//       audienceType: "individual",
//       recipientId: parent.sender.id,
//       content: content.trim(),
//       parentMessage: parent._id,
//       isReply: true,
//     });

//     await dispatchReplyNotification(reply, parent.sender.role, parent.sender.id);

//     req.flash("success", "Reply sent.");
//     return res.redirect("back");
//   })
// );

// // ================= ADMIN — META (cascading dropdowns, global — admin sees everything) =================
// app.get(
//   "/admin/message/meta/semesters",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { class: className } = req.query;
//     if (!className) return res.json({ semesters: [] });
//     const semesters = await Student.distinct("semester", { class: className, status: "Active" });
//     res.json({ semesters });
//   })
// );

// app.get(
//   "/admin/message/meta/sections",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { class: className, semester } = req.query;
//     if (!className || !semester) return res.json({ sections: [] });
//     const sections = await Student.distinct("section", { class: className, semester, status: "Active" });
//     res.json({ sections });
//   })
// );

// app.get(
//   "/admin/message/student/search",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { q } = req.query;
//     if (!q || !q.trim()) return res.json({ students: [] });

//     const query = q.trim();
//     const isNumeric = /^\d+$/.test(query);

//     const students = await Student.find({
//       status: "Active",
//       $or: [{ name: { $regex: query, $options: "i" } }, ...(isNumeric ? [{ rollNo: Number(query) }] : [])],
//     })
//       .select("name rollNo class semester section")
//       .limit(15);

//     res.json({ students });
//   })
// );

// app.get(
//   "/admin/message/teacher/search",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { q } = req.query;
//     if (!q || !q.trim()) return res.json({ teachers: [] });

//     const teachers = await Teacher.find({
//       status: "Active",
//       $or: [{ name: { $regex: q.trim(), $options: "i" } }, { mobile: { $regex: q.trim(), $options: "i" } }],
//     })
//       .select("name email mobile")
//       .limit(20);

//     res.json({ teachers });
//   })
// );

// // ================= ADMIN — REPLY PERMISSION SETTINGS =================
// app.get(
//   "/admin/message/settings",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const messagesettings = await MessageSettings.getSettings();
    
//     res.render("admin/messages/settings.ejs", { messagesettings });
//   })
// );

// app.post(
//   "/admin/message/settings/toggle-student-reply",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const settings = await MessageSettings.getSettings();
//     settings.allowStudentReply = !settings.allowStudentReply;
//     await settings.save();

//     req.flash("success", `Student reply is now ${settings.allowStudentReply ? "ENABLED" : "DISABLED"}.`);
//     return res.redirect("back");
//   })
// );

// // ================= ADMIN — NOTIFICATIONS =================
// app.get(
//   "/admin/notifications/unread-count",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const count = await Notification.countDocuments({
//       recipientId: req.user._id,
//       recipientRole: "Admin",
//       isRead: false,
//     });
//     res.json({ count });
//   })
// );

// app.post(
//   "/admin/notifications/mark-all-read",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     await Notification.updateMany(
//       { recipientId: req.user._id, recipientRole: "Admin", isRead: false },
//       { $set: { isRead: true } }
//     );
//     res.json({ success: true });
//   })
// );

///////////////////////////////////////////////////////////////////////////////////







// // Helper function to resolve active tab from query/body
// const getTargetTab = (req) => {
//   if (req.body && req.body.tab && ["student", "teacher"].includes(req.body.tab)) {
//     return req.body.tab;
//   }
//   if (req.query && req.query.tab && ["student", "teacher"].includes(req.query.tab)) {
//     return req.query.tab;
//   }
//   return "teacher";
// };

// // ================= ADMIN — GET RECEIVED THREADS =================
// app.get(
//   "/admin/message/received",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const activeTab = req.query.tab === "student" ? "student" : "teacher";
//     const filterUnread = req.query.filter === "unread";
//     const page = Math.max(1, parseInt(req.query.page, 10) || 1);
//     const limit = 30;
//     const skip = (page - 1) * limit;

//     const senderRole = activeTab === "student" ? "Student" : "Teacher";
//     const selectFields =
//       activeTab === "student"
//         ? "name rollNo class semester section"
//         : "name department designation email";

//     // 1. Find all messages sent BY this senderRole to Admin
//     const targetMessages = await Message.find({
//       recipientRole: "Admin",
//       recipientId: req.user._id,
//       "sender.role": senderRole,
//     }).select("parentMessage _id").lean();

//     // Collect Root Parent IDs
//     const rootIds = [
//       ...new Set(
//         targetMessages.map((m) =>
//           m.parentMessage ? m.parentMessage.toString() : m._id.toString()
//         )
//       ),
//     ];

//     let rootQuery = { _id: { $in: rootIds } };

//     if (filterUnread) {
//       rootQuery["readBy.userId"] = { $ne: req.user._id };
//     }

//     const totalThreads = await Message.countDocuments(rootQuery);
//     const totalPages = Math.ceil(totalThreads / limit) || 1;

//     // Fetch Root Threads
//     const rootMessages = await Message.find(rootQuery)
//       .populate({
//         path: "sender.id",
//         select: "name role",
//       })
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       .lean();

//     // Fetch all Child Replies under these root threads with deeper population
//     const fetchedRootIds = rootMessages.map((m) => m._id);
//     const allChildReplies = await Message.find({
//       parentMessage: { $in: fetchedRootIds },
//     })
//       .populate({
//         path: "sender.id",
//         select: selectFields,
//       })
//       .populate({
//         path: "recipientId",
//         select: "name department designation rollNo class semester section",
//       })
//       .sort({ createdAt: 1 })
//       .lean();

//     // Group child replies under their root parent ID
//     const childMap = {};
//     allChildReplies.forEach((reply) => {
//       const pId = reply.parentMessage.toString();
//       if (!childMap[pId]) childMap[pId] = [];
//       childMap[pId].push(reply);
//     });

//     const receivedThreads = rootMessages.map((root) => {
//       return {
//         ...root,
//         replies: childMap[root._id.toString()] || [],
//       };
//     });

//     // Unread Counts
//     const unreadStudentCount = await Message.countDocuments({
//       recipientRole: "Admin",
//       recipientId: req.user._id,
//       "sender.role": "Student",
//       "readBy.userId": { $ne: req.user._id },
//     });

//     const unreadTeacherCount = await Message.countDocuments({
//       recipientRole: "Admin",
//       recipientId: req.user._id,
//       "sender.role": "Teacher",
//       "readBy.userId": { $ne: req.user._id },
//     });

//     // 3-Page Window Array
//     let startPage = page;
//     if (startPage + 2 > totalPages) {
//       startPage = Math.max(1, totalPages - 2);
//     }
//     const pageWindow = [];
//     for (let i = startPage; i <= Math.min(totalPages, startPage + 2); i++) {
//       pageWindow.push(i);
//     }

//     res.render("admin/messages/received.ejs", {
//       receivedThreads,
//       activeTab,
//       filterUnread,
//       unreadStudentCount,
//       unreadTeacherCount,
//       currentPage: page,
//       totalPages,
//       pageWindow,
//       req,
//     });
//   })
// );

// // ================= ADMIN — MARK ALL AS READ =================
// app.post(
//   "/admin/message/mark-all-read",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const activeTab = getTargetTab(req);
//     const senderRole = activeTab === "student" ? "Student" : "Teacher";

//     const unreadMsgs = await Message.find({
//       recipientRole: "Admin",
//       recipientId: req.user._id,
//       "sender.role": senderRole,
//       "readBy.userId": { $ne: req.user._id },
//     }).select("_id");

//     if (unreadMsgs.length > 0) {
//       const msgIds = unreadMsgs.map((m) => m._id);
//       const readReceipt = { userId: req.user._id, role: "Admin", readAt: new Date() };

//       await Message.updateMany(
//         { _id: { $in: msgIds } },
//         { $push: { readBy: readReceipt } }
//       );

//       req.flash("success", `Marked ${msgIds.length} ${activeTab} message(s) as read.`);
//     } else {
//       req.flash("info", "No unread messages found in this view.");
//     }

//     return res.redirect(`/admin/message/received?tab=${activeTab}`);
//   })
// );

// // ================= ADMIN — REPLY TO MESSAGE =================
// app.post(
//   "/admin/message/:id/reply",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     let { content, tab } = req.body;
//     const parentMsgId = req.params.id;

//     const targetMsg = await Message.findById(parentMsgId);
//     const activeTab = tab || (targetMsg && targetMsg.sender.role === "Student" ? "student" : "teacher");

//     if (!content || !content.trim()) {
//       if (req.xhr || req.headers.accept?.includes("json")) {
//         return res.status(400).json({ success: false, message: "Reply text cannot be empty." });
//       }
//       req.flash("error", "Reply text cannot be empty.");
//       return res.redirect(`/admin/message/received?tab=${activeTab}`);
//     }

//     content = content.replace(/\r\n/g, "\n").trim();

//     if (!targetMsg) {
//       if (req.xhr || req.headers.accept?.includes("json")) {
//         return res.status(404).json({ success: false, message: "Parent message was deleted or not found." });
//       }
//       req.flash("error", "Parent message was deleted or not found.");
//       return res.redirect(`/admin/message/received?tab=${activeTab}`);
//     }

//     // Always link to the thread root parent ID
//     const rootParentId = targetMsg.parentMessage ? targetMsg.parentMessage : targetMsg._id;

//     const replyMessage = new Message({
//       sender: {
//         id: req.user._id,
//         role: "Admin",
//         name: req.user.name || "Super Admin",
//       },
//       recipientRole: targetMsg.sender.role,
//       audienceType: "individual",
//       recipientId: targetMsg.sender.id,
//       content: content,
//       parentMessage: rootParentId,
//       isReply: true,
//       readBy: [{ userId: req.user._id, role: "Admin", readAt: new Date() }],
//     });

//     await replyMessage.save();

//     // Mark original message read if not read yet
//     if (!targetMsg.isReadBy(req.user._id)) {
//       targetMsg.readBy.push({ userId: req.user._id, role: "Admin", readAt: new Date() });
//       await targetMsg.save();
//     }

//     if (req.xhr || req.headers.accept?.includes("json")) {
//       return res.json({ success: true, message: "Reply sent successfully.", reply: replyMessage });
//     }

//     req.flash("success", "Reply sent successfully.");
//     return res.redirect(`/admin/message/received?tab=${activeTab}`);
//   })
// );

// // ================= ADMIN — HARD DELETE (SINGLE REPLY OR THREAD REPLIES) =================
// app.post(
//   "/admin/message/:id/delete",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const activeTab = getTargetTab(req);
//     const msgId = req.params.id;

//     const targetMsg = await Message.findById(msgId);

//     if (targetMsg) {
//       const isRootThread = targetMsg.parentMessage === null;

//       if (isRootThread) {
//         // Hard Delete: Delete ALL nested child replies under this root thread, keep Root Message Safe
//         const result = await Message.deleteMany({ parentMessage: msgId });
//         req.flash("success", `Cleared ${result.deletedCount} reply(ies) from thread. Original parent message is retained.`);
//       } else {
//         // Hard Delete: Delete specific child reply permanently from database
//         await Message.deleteOne({ _id: msgId });
//         req.flash("success", "Selected reply deleted permanently from database.");
//       }
//     } else {
//       req.flash("error", "Message not found.");
//     }

//     return res.redirect(`/admin/message/received?tab=${activeTab}`);
//   })
// );

// // ================= ADMIN — BULK HARD DELETE REPLIES =================
// app.post(
//   "/admin/message/bulk-delete",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const activeTab = getTargetTab(req);
//     let { messageIds } = req.body;

//     if (typeof messageIds === "string") messageIds = [messageIds];

//     if (Array.isArray(messageIds) && messageIds.length > 0) {
//       // Hard Delete: Remove checked replies permanently from database
//       const result = await Message.deleteMany({ _id: { $in: messageIds } });
//       req.flash("success", `Permanently deleted ${result.deletedCount} selected reply(ies) from database.`);
//     } else {
//       req.flash("error", "No replies selected for deletion.");
//     }

//     return res.redirect(`/admin/message/received?tab=${activeTab}`);
//   })
// );
// // ================= ADMIN — MARK ALL AS READ =================
// app.post(
//   "/admin/message/mark-all-read",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const activeTab = getTargetTab(req);
//     const senderRole = activeTab === "student" ? "Student" : "Teacher";

//     const unreadMsgs = await Message.find({
//       recipientRole: "Admin",
//       recipientId: req.user._id,
//       "sender.role": senderRole,
//       "readBy.userId": { $ne: req.user._id },
//     }).select("_id");

//     if (unreadMsgs.length > 0) {
//       const msgIds = unreadMsgs.map((m) => m._id);
//       const readReceipt = { userId: req.user._id, role: "Admin", readAt: new Date() };

//       await Message.updateMany(
//         { _id: { $in: msgIds } },
//         { $push: { readBy: readReceipt } }
//       );

//       req.flash("success", `Marked ${msgIds.length} ${activeTab} message(s) as read.`);
//     } else {
//       req.flash("info", "No unread messages found in this view.");
//     }

//     return res.redirect(`/admin/message/received?tab=${activeTab}`);
//   })
// );

// // ================= ADMIN — REPLY TO MESSAGE (ROOT OR CHILD) =================
// app.post(
//   "/admin/message/:id/reply",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     let { content, tab } = req.body;
//     const parentMsgId = req.params.id;

//     const targetMsg = await Message.findById(parentMsgId);
//     const activeTab = tab || (targetMsg && targetMsg.sender.role === "Student" ? "student" : "teacher");

//     if (!content || !content.trim()) {
//       if (req.xhr || req.headers.accept?.includes("json")) {
//         return res.status(400).json({ success: false, message: "Reply text cannot be empty." });
//       }
//       req.flash("error", "Reply text cannot be empty.");
//       return res.redirect(`/admin/message/received?tab=${activeTab}`);
//     }

//     content = content.replace(/\r\n/g, "\n").trim();

//     if (!targetMsg) {
//       if (req.xhr || req.headers.accept?.includes("json")) {
//         return res.status(404).json({ success: false, message: "Parent message was not found." });
//       }
//       req.flash("error", "Parent message was not found.");
//       return res.redirect(`/admin/message/received?tab=${activeTab}`);
//     }

//     // Always link to thread root parent ID
//     const rootParentId = targetMsg.parentMessage ? targetMsg.parentMessage : targetMsg._id;

//     const replyMessage = new Message({
//       sender: {
//         id: req.user._id,
//         role: "Admin",
//         name: req.user.name || "Admin",
//       },
//       recipientRole: targetMsg.sender.role,
//       audienceType: "individual",
//       recipientId: targetMsg.sender.id,
//       content: content,
//       parentMessage: rootParentId,
//       isReply: true,
//       readBy: [{ userId: req.user._id, role: "Admin", readAt: new Date() }],
//     });

//     await replyMessage.save();

//     // Mark original message read
//     if (!targetMsg.isReadBy || !targetMsg.isReadBy(req.user._id)) {
//       targetMsg.readBy.push({ userId: req.user._id, role: "Admin", readAt: new Date() });
//       await targetMsg.save();
//     }

//     if (req.xhr || req.headers.accept?.includes("json")) {
//       return res.json({ success: true, message: "Reply sent successfully.", reply: replyMessage });
//     }

//     req.flash("success", "Reply sent successfully.");
//     return res.redirect(`/admin/message/received?tab=${activeTab}`);
//   })
// );


// // ================= ADMIN — INDIVIDUAL HARD DELETE =================
// app.post(
//   "/admin/message/:id/delete",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const activeTab = getTargetTab(req);
//     const msgId = req.params.id;

//     const targetMsg = await Message.findById(msgId);

//     if (targetMsg) {
//       await Message.deleteOne({ _id: msgId });
//       req.flash("success", "Reply permanently deleted.");
//     } else {
//       req.flash("error", "Message reply not found.");
//     }

//     return res.redirect(`/admin/message/received?tab=${activeTab}`);
//   })
// );

// // ================= ADMIN — BULK HARD DELETE =================
// app.post(
//   "/admin/message/bulk-delete",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const activeTab = getTargetTab(req);
//     let { messageIds } = req.body;

//     if (typeof messageIds === "string") messageIds = [messageIds];

//     if (Array.isArray(messageIds) && messageIds.length > 0) {
//       await Message.deleteMany({ _id: { $in: messageIds } });
//       req.flash("success", `${messageIds.length} selected reply(ies) permanently deleted.`);
//     } else {
//       req.flash("error", "No messages selected for deletion.");
//     }

//     return res.redirect(`/admin/message/received?tab=${activeTab}`);
//   })
// );




// Helper function to resolve active tab from query/body
const getTargetTab = (req) => {
  if (req.body && req.body.tab && ["student", "teacher"].includes(req.body.tab)) {
    return req.body.tab;
  }
  if (req.query && req.query.tab && ["student", "teacher"].includes(req.query.tab)) {
    return req.query.tab;
  }
  return "teacher";
};


// ================= ADMIN — GET RECEIVED THREADS =================
app.get(
  "/admin/message/received",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const activeTab = req.query.tab === "student" ? "student" : "teacher";
    const filterUnread = req.query.filter === "unread";
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 30;
    const skip = (page - 1) * limit;

    const senderRole = activeTab === "student" ? "Student" : "Teacher";

    // Dynamic ref selection for Mongoose populate based on sender.role
    const studentSelect = "name rollNo class semester section";
    const teacherSelect = "name department designation email";

    // 1. Find all messages sent BY this senderRole to Admin
    const targetMessages = await Message.find({
      recipientRole: "Admin",
      recipientId: req.user._id,
      "sender.role": senderRole,
    }).select("parentMessage _id").lean();

    // Collect Root Parent IDs
    const rootIds = [
      ...new Set(
        targetMessages.map((m) =>
          m.parentMessage ? m.parentMessage.toString() : m._id.toString()
        )
      ),
    ];

    let rootQuery = { _id: { $in: rootIds } };

    if (filterUnread) {
      rootQuery["readBy.userId"] = { $ne: req.user._id };
    }

    const totalThreads = await Message.countDocuments(rootQuery);
    const totalPages = Math.ceil(totalThreads / limit) || 1;

    // Fetch Root Threads
    const rootMessages = await Message.find(rootQuery)
      .populate({
        path: "sender.id",
        refPath: "sender.role",
        select: activeTab === "student" ? studentSelect : teacherSelect,
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Fetch all Child Replies under these root threads with dynamic refs
    const fetchedRootIds = rootMessages.map((m) => m._id);
    const allChildReplies = await Message.find({
      parentMessage: { $in: fetchedRootIds },
    })
      .populate({
        path: "sender.id",
        refPath: "sender.role",
        select: `${studentSelect} ${teacherSelect}`,
      })
      .populate({
        path: "recipientId",
        refPath: "recipientRole",
        select: `${studentSelect} ${teacherSelect}`,
      })
      .sort({ createdAt: 1 })
      .lean();

    // Group child replies under their root parent ID
    const childMap = {};
    allChildReplies.forEach((reply) => {
      const pId = reply.parentMessage.toString();
      if (!childMap[pId]) childMap[pId] = [];
      childMap[pId].push(reply);
    });

    const receivedThreads = rootMessages.map((root) => {
      return {
        ...root,
        replies: childMap[root._id.toString()] || [],
      };
    });

    // Unread Counts
    const unreadStudentCount = await Message.countDocuments({
      recipientRole: "Admin",
      recipientId: req.user._id,
      "sender.role": "Student",
      "readBy.userId": { $ne: req.user._id },
    });

    const unreadTeacherCount = await Message.countDocuments({
      recipientRole: "Admin",
      recipientId: req.user._id,
      "sender.role": "Teacher",
      "readBy.userId": { $ne: req.user._id },
    });

    // 3-Page Window Array
    let startPage = page;
    if (startPage + 2 > totalPages) {
      startPage = Math.max(1, totalPages - 2);
    }
    const pageWindow = [];
    for (let i = startPage; i <= Math.min(totalPages, startPage + 2); i++) {
      pageWindow.push(i);
    }

    res.render("admin/messages/received.ejs", {
      receivedThreads,
      activeTab,
      filterUnread,
      unreadStudentCount,
      unreadTeacherCount,
      currentPage: page,
      totalPages,
      pageWindow,
      req,
    });
  })
);

// ================= ADMIN — MARK ALL AS READ =================
app.post(
  "/admin/message/mark-all-read",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const activeTab = getTargetTab(req);
    const senderRole = activeTab === "student" ? "Student" : "Teacher";

    const unreadMsgs = await Message.find({
      recipientRole: "Admin",
      recipientId: req.user._id,
      "sender.role": senderRole,
      "readBy.userId": { $ne: req.user._id },
    }).select("_id");

    if (unreadMsgs.length > 0) {
      const msgIds = unreadMsgs.map((m) => m._id);
      const readReceipt = { userId: req.user._id, role: "Admin", readAt: new Date() };

      await Message.updateMany(
        { _id: { $in: msgIds } },
        { $push: { readBy: readReceipt } }
      );

      req.flash("success", `Marked ${msgIds.length} ${activeTab} message(s) as read.`);
    } else {
      req.flash("info", "No unread messages found in this view.");
    }

    return res.redirect(`/admin/message/received?tab=${activeTab}`);
  })
);

// ================= ADMIN — REPLY TO MESSAGE (WITH TRANSACTION & NOTIFICATION) =================
app.post(
  "/admin/message/:id/reply",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    let { content, tab } = req.body;
    const parentMsgId = req.params.id;

    const targetMsg = await Message.findById(parentMsgId);
    const activeTab = tab || (targetMsg && targetMsg.sender.role === "Student" ? "student" : "teacher");

    if (!content || !content.trim()) {
      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.status(400).json({ success: false, message: "Reply text cannot be empty." });
      }
      req.flash("error", "Reply text cannot be empty.");
      return res.redirect(`/admin/message/received?tab=${activeTab}`);
    }

    content = content.replace(/\r\n/g, "\n").trim();

    if (!targetMsg) {
      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.status(404).json({ success: false, message: "Parent message was deleted or not found." });
      }
      req.flash("error", "Parent message was deleted or not found.");
      return res.redirect(`/admin/message/received?tab=${activeTab}`);
    }

    const rootParentId = targetMsg.parentMessage ? targetMsg.parentMessage : targetMsg._id;

    // MongoDB Session Start for Transaction Safety
    const session = await Message.startSession();
    session.startTransaction();

    try {
      const replyMessage = new Message({
        sender: {
          id: req.user._id,
          role: "Admin",
          name: req.user.name || "Super Admin",
        },
        recipientRole: targetMsg.sender.role,
        audienceType: "individual",
        recipientId: targetMsg.sender.id,
        content: content,
        parentMessage: rootParentId,
        isReply: true,
        readBy: [{ userId: req.user._id, role: "Admin", readAt: new Date() }],
      });

      await replyMessage.save({ session });

      // Mark original message read if not read yet
      if (!targetMsg.isReadBy || !targetMsg.isReadBy(req.user._id)) {
        targetMsg.readBy.push({ userId: req.user._id, role: "Admin", readAt: new Date() });
        await targetMsg.save({ session });
      }

      // Dispatch Reply Notification inside transaction
      await dispatchReplyNotification(replyMessage, targetMsg.sender.role, targetMsg.sender.id, session);

      await session.commitTransaction();
      session.endSession();

      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.json({ success: true, message: "Reply sent successfully.", reply: replyMessage });
      }

      req.flash("success", "Reply sent successfully.");
      return res.redirect(`/admin/message/received?tab=${activeTab}`);
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error in reply transaction:", error);

      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.status(500).json({ success: false, message: "Transaction failed. Reply aborted." });
      }
      req.flash("error", "Failed to send reply. Changes rolled back.");
      return res.redirect(`/admin/message/received?tab=${activeTab}`);
    }
  })
);

// ================= ADMIN — HARD DELETE (SINGLE REPLY OR THREAD REPLIES) =================
app.post(
  "/admin/message/:id/delete",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const activeTab = getTargetTab(req);
    const msgId = req.params.id;

    const targetMsg = await Message.findById(msgId);

    if (targetMsg) {
      const isRootThread = targetMsg.parentMessage === null;

      if (isRootThread) {
        // Hard Delete: Delete ALL nested child replies under this root thread, keep Root Message Safe
        const result = await Message.deleteMany({ parentMessage: msgId });
        req.flash("success", `Cleared ${result.deletedCount} reply(ies) from thread. Original parent message is retained.`);
      } else {
        // Hard Delete: Delete specific child reply permanently from database
        await Message.deleteOne({ _id: msgId });
        req.flash("success", "Selected reply deleted permanently from database.");
      }
    } else {
      req.flash("error", "Message not found.");
    }

    return res.redirect(`/admin/message/received?tab=${activeTab}`);
  })
);

// ================= ADMIN — BULK HARD DELETE REPLIES =================
app.post(
  "/admin/message/bulk-delete",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const activeTab = getTargetTab(req);
    let { messageIds } = req.body;

    if (typeof messageIds === "string") messageIds = [messageIds];

    if (Array.isArray(messageIds) && messageIds.length > 0) {
      // Hard Delete: Remove checked replies (Admin + Student + Teacher) permanently
      const result = await Message.deleteMany({ _id: { $in: messageIds } });
      req.flash("success", `Permanently deleted ${result.deletedCount} selected reply(ies) from database.`);
    } else {
      req.flash("error", "No replies selected for deletion.");
    }

    return res.redirect(`/admin/message/received?tab=${activeTab}`);
  })
);

// // ================= ADMIN — SETTINGS PAGE =================
 app.get(
  "/admin/message/settings",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const messagesettings = await MessageSettings.getSettings();
    res.render("admin/messages/settings.ejs", { messagesettings });
  })
);

// ================= ADMIN — SETTINGS 3 SEPARATE TOGGLES =================
 app.post(
  "/admin/message/settings/toggle-student-admin-reply",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const settings = await MessageSettings.getSettings();
    settings.allowStudentToAdminReply = !settings.allowStudentToAdminReply;
    await settings.save();

    req.flash("success", `Student-to-Admin reply permission ${settings.allowStudentToAdminReply ? "enabled" : "disabled"}.`);
    return res.redirect("/admin/message/settings");
  })
);

 app.post(
  "/admin/message/settings/toggle-student-teacher-reply",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const settings = await MessageSettings.getSettings();
    settings.allowStudentToTeacherReply = !settings.allowStudentToTeacherReply;
    await settings.save();

    req.flash("success", `Student-to-Teacher reply permission ${settings.allowStudentToTeacherReply ? "enabled" : "disabled"}.`);
    return res.redirect("/admin/message/settings");
  })
);

 app.post(
  "/admin/message/settings/toggle-teacher-admin-reply",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const settings = await MessageSettings.getSettings();
    settings.allowTeacherToAdminReply = !settings.allowTeacherToAdminReply;
    await settings.save();

    req.flash("success", `Teacher-to-Admin reply permission ${settings.allowTeacherToAdminReply ? "enabled" : "disabled"}.`);
    return res.redirect("/admin/message/settings");
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
    res.render("teachers/messages/compose-student.ejs", { classes });
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

    res.render("teachers/messages/sent-student.ejs", { sentMessages });
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

    res.render("teachers/messages/received.ejs", { receivedMessages });
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

    res.render("students/messages/index.ejs", { messages, canReply: settings. allowStudentToAdminReply });
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
    if (!settings. allowStudentToAdminReply) {
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



// ⚠️ Agar tere original file me kahin "app.listen(...)" already likha hai,
// usse HATA dena — ab sirf "server.listen(...)" chalega, dono nahi.

// // ------------------ WebSockets Real-Time Setup ------------------
// const onlineUsers = new Map(); // Store active socket user IDs (UserId -> SocketID)

// io.on("connection", (socket) => {
//   socket.on("registerUser", (userId) => {
//     if (userId) {
//       onlineUsers.set(userId.toString(), socket.id);
//       socket.join(userId.toString());
//     }
//   });

//   socket.on("disconnect", () => {
//     for (let [key, value] of onlineUsers.entries()) {
//       if (value === socket.id) {
//         onlineUsers.delete(key);
//         break;
//       }
//     }
//   });
// });

// // Helper for sending push real-time notifications
// const sendSocketNotification = (userIds, eventName, payload) => {
//   if (Array.isArray(userIds)) {
//     userIds.forEach((id) => {
//       io.to(id.toString()).emit(eventName, payload);
//     });
//   } else if (userIds) {
//     io.to(userIds.toString()).emit(eventName, payload);
//   }
// };

// // Database Connection
// async function main() {
//   await mongoose.connect(dbUrl);
// }
// main()
//   .then(() => console.log("MongoDB Connected Successfully ✔"))
//   .catch((err) => console.log("MongoDB Error ❌", err));

// // =========================================================================
// // 👑 1. ADMIN MESSAGING ROUTES & CONTROLLER LOGIC
// // =========================================================================

// // Render Admin Message Panel
// app.get(
//   "/admin/messages",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const students = await Student.find({});
//     const teachers = await Teacher.find({});
    
//     // Dynamic Filter lists for Admin Student Filter
//     const classes = [...new Set(students.map((s) => s.class))];
//     const semesters = [...new Set(students.map((s) => s.semester))];
//     const sections = [...new Set(students.map((s) => s.section))];

//     const messages = await Message.find({ senderRole: "Admin" })
//       .populate("recipientStudentId")
//       .populate("recipientTeacherId")
//       .sort({ createdAt: -1 });

//     let settings = await AdminSettings.findOne();
//     if (!settings) {
//       settings = await AdminSettings.create({ studentReplyAllowed: true });
//     }

//     res.render("admin/messages.ejs", {
//       students,
//       teachers,
//       classes,
//       semesters,
//       sections,
//       messages,
//       studentReplyAllowed: settings.studentReplyAllowed,
//     });
//   })
// );

// // Toggle Student Global Reply Permission Toggle
// app.post(
//   "/admin/messages/toggle-reply",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     let settings = await AdminSettings.findOne();
//     if (!settings) {
//       settings = new AdminSettings();
//     }
//     settings.studentReplyAllowed = !settings.studentReplyAllowed;
//     await settings.save();
    
//     // Realtime update socket notification to all connected clients
//     io.emit("permissionUpdated", { studentReplyAllowed: settings.studentReplyAllowed });
    
//     req.flash("success", `Student Reply Permission updated to ${settings.studentReplyAllowed ? "ALLOWED" : "DISALLOWED"}`);
//     res.redirect("/admin/messages");
//   })
// );

// // Admin Send Message (Student / Teacher)
// app.post(
//   "/admin/messages/send",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { targetGroup, filterClass, filterSem, filterSec, studentId, teacherTargetType, teacherId, messageText } = req.body;
//     const adminUser = req.user;

//     if (targetGroup === "Student") {
//       if (studentId && studentId !== "ALL") {
//         // Individual Student Message
//         const student = await Student.findById(studentId);
//         if (!student) throw new ExpressError("Student Not Found", 404);

//         const newMsg = await Message.create({
//           senderId: adminUser._id,
//           senderRole: "Admin",
//           senderName: adminUser.name || "Admin",
//           recipientType: "Student",
//           targetType: "Individual",
//           recipientStudentId: student._id,
//           studentDetails: {
//             rollNo: student.rollNo,
//             name: student.name,
//             className: student.class,
//             semester: student.semester,
//             section: student.section,
//           },
//           messageText,
//         });

//         sendSocketNotification(student._id, "newMessage", {
//           title: "New Message from Admin",
//           text: messageText,
//         });
//       } else {
//         // Bulk Student Message
//         let filter = {};
//         if (filterClass && filterClass !== "ALL") filter.class = filterClass;
//         if (filterSem && filterSem !== "ALL") filter.semester = filterSem;
//         if (filterSec && filterSec !== "ALL") filter.section = filterSec;

//         const targetStudents = await Student.find(filter);
//         const targetIds = targetStudents.map((s) => s._id);

//         await Message.create({
//           senderId: adminUser._id,
//           senderRole: "Admin",
//           senderName: adminUser.name || "Admin",
//           recipientType: "Student",
//           targetType: "Bulk",
//           className: filterClass || "ALL",
//           semester: filterSem || "ALL",
//           section: filterSec || "ALL",
//           messageText,
//         });

//         sendSocketNotification(targetIds, "newMessage", {
//           title: "New Bulk Announcement",
//           text: messageText,
//         });
//       }
//     } else if (targetGroup === "Teacher") {
//       if (teacherTargetType === "Individual" && teacherId) {
//         // Individual Teacher Message
//         const teacher = await Teacher.findById(teacherId);
//         const newMsg = await Message.create({
//           senderId: adminUser._id,
//           senderRole: "Admin",
//           senderName: adminUser.name || "Admin",
//           recipientType: "Teacher",
//           targetType: "Individual",
//           recipientTeacherId: teacher._id,
//           messageText,
//         });

//         sendSocketNotification(teacher._id, "newMessage", {
//           title: "New Message from Admin",
//           text: messageText,
//         });
//       } else {
//         // Bulk Teacher Message: Save individual records for every teacher per business rule
//         const allTeachers = await Teacher.find({});
//         const teacherIds = [];

//         for (let teacher of allTeachers) {
//           teacherIds.push(teacher._id);
//           await Message.create({
//             senderId: adminUser._id,
//             senderRole: "Admin",
//             senderName: adminUser.name || "Admin",
//             recipientType: "Teacher",
//             targetType: "Individual",
//             recipientTeacherId: teacher._id,
//             messageText,
//           });
//         }

//         sendSocketNotification(teacherIds, "newMessage", {
//           title: "New Message from Admin",
//           text: messageText,
//         });
//       }
//     }

//     req.flash("success", "Message dispatched successfully!");
//     res.redirect("/admin/messages");
//   })
// );

// // Admin Edit Message
// app.put(
//   "/admin/messages/:id",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;
//     const { messageText } = req.body;
//     await Message.findByIdAndUpdate(id, { messageText });
//     req.flash("success", "Message updated!");
//     res.redirect("/admin/messages");
//   })
// );

// // Admin Delete Message
// app.delete(
//   "/admin/messages/:id",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;
//     await Message.findByIdAndDelete(id);
//     req.flash("success", "Message deleted successfully!");
//     res.redirect("/admin/messages");
//   })
// );

// // Admin Reply Handler
// app.post(
//   "/admin/messages/:id/reply",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;
//     const { replyText } = req.body;
//     const msg = await Message.findById(id);

//     msg.replies.push({
//       senderId: req.user._id,
//       senderRole: "Admin",
//       senderName: req.user.name || "Admin",
//       message: replyText,
//     });
//     await msg.save();

//     req.flash("success", "Reply sent!");
//     res.redirect("/admin/messages");
//   })
// );

// // =========================================================================
// // 👨‍🏫 2. TEACHER MESSAGING ROUTES & CONTROLLER LOGIC
// // =========================================================================

// app.get(
//   "/teacher/messages",
//   verifySession,
//   isLoggedIn,
//   WrapAsync(async (req, res) => {
//     const teacher = req.user;

//     // Filter assigned classes, semesters, sections & subjects from Teacher schema
//     const assignedClasses = teacher.class || [];
    
//     // Received Messages for Teacher (Individual only as per business logic requirement)
//     const receivedMessages = await Message.find({
//       recipientType: "Teacher",
//       recipientTeacherId: teacher._id,
//     }).sort({ createdAt: -1 });

//     // Messages sent by Teacher
//     const sentMessages = await Message.find({
//       senderId: teacher._id,
//       senderRole: "Teacher",
//     }).sort({ createdAt: -1 });

//     res.render("teachers/messages.ejs", {
//       teacher,
//       assignedClasses,
//       receivedMessages,
//       sentMessages,
//     });
//   })
// );

// // Dynamic Helper API to get Students assigned to Teacher Filter
// app.get(
//   "/teacher/api/filter-students",
//   verifySession,
//   isLoggedIn,
//   WrapAsync(async (req, res) => {
//     const { className, semester, section } = req.query;
//     let query = {};
//     if (className) query.class = className;
//     if (semester) query.semester = semester;
//     if (section) query.section = section;

//     const students = await Student.find(query).select("_id name rollNo class semester section");
//     res.json({ success: true, students });
//   })
// );

// // Teacher Send Message to Students
// app.post(
//   "/teacher/messages/send",
//   verifySession,
//   isLoggedIn,
//   WrapAsync(async (req, res) => {
//     const teacher = req.user;
//     const { className, semester, section, subjectName, studentId, messageText } = req.body;

//     if (studentId && studentId !== "ALL") {
//       const student = await Student.findById(studentId);
//       await Message.create({
//         senderId: teacher._id,
//         senderRole: "Teacher",
//         senderName: teacher.name,
//         recipientType: "Student",
//         targetType: "Individual",
//         recipientStudentId: student._id,
//         className,
//         semester,
//         section,
//         subjectName,
//         studentDetails: {
//           rollNo: student.rollNo,
//           name: student.name,
//           className: student.class,
//           semester: student.semester,
//           section: student.section,
//         },
//         messageText,
//       });

//       sendSocketNotification(student._id, "newMessage", {
//         title: `Message from ${teacher.name} (${subjectName})`,
//         text: messageText,
//       });
//     } else {
//       // Bulk Student send by assigned Class/Sem/Section/Subject
//       const filter = { class: className, semester, section };
//       const students = await Student.find(filter);
//       const studentIds = students.map((s) => s._id);

//       await Message.create({
//         senderId: teacher._id,
//         senderRole: "Teacher",
//         senderName: teacher.name,
//         recipientType: "Student",
//         targetType: "Bulk",
//         className,
//         semester,
//         section,
//         subjectName,
//         messageText,
//       });

//       sendSocketNotification(studentIds, "newMessage", {
//         title: `Announcement from ${teacher.name} (${subjectName})`,
//         text: messageText,
//       });
//     }

//     req.flash("success", "Message sent to students successfully!");
//     res.redirect("/teacher/messages");
//   })
// );

// // Teacher Edit Message
// app.put(
//   "/teacher/messages/:id",
//   verifySession,
//   isLoggedIn,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;
//     const { messageText } = req.body;
//     await Message.findOneAndUpdate({ _id: id, senderId: req.user._id }, { messageText });
//     req.flash("success", "Message edited!");
//     res.redirect("/teacher/messages");
//   })
// );

// // Teacher Delete Message
// app.delete(
//   "/teacher/messages/:id",
//   verifySession,
//   isLoggedIn,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;
//     await Message.findOneAndDelete({ _id: id, senderId: req.user._id });
//     req.flash("success", "Message deleted!");
//     res.redirect("/teacher/messages");
//   })
// );

// // Teacher Reply Route
// app.post(
//   "/teacher/messages/:id/reply",
//   verifySession,
//   isLoggedIn,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;
//     const { replyText } = req.body;
//     const msg = await Message.findById(id);

//     msg.replies.push({
//       senderId: req.user._id,
//       senderRole: "Teacher",
//       senderName: req.user.name,
//       message: replyText,
//     });
//     await msg.save();

//     // Socket notification back to sender
//     sendSocketNotification(msg.senderId, "newReply", {
//       title: `Reply from ${req.user.name}`,
//       text: replyText,
//     });

//     req.flash("success", "Reply added!");
//     res.redirect("/teacher/messages");
//   })
// );

// // =========================================================================
// // 🎓 3. STUDENT MESSAGING ROUTES & CONTROLLER LOGIC
// // =========================================================================

// app.get(
//   "/student/messages",
//   verifySession,
//   isStudentVerified,
//   WrapAsync(async (req, res) => {
//     const student = req.user;

//     // Check Global Admin Reply Permission
//     const settings = await AdminSettings.findOne();
//     const isReplyAllowed = settings ? settings.studentReplyAllowed : true;

//     // Direct Messages sent to student specifically OR Bulk messages matching Class/Sem/Sec
//     const messages = await Message.find({
//       recipientType: "Student",
//       $or: [
//         { targetType: "Individual", recipientStudentId: student._id },
//         {
//           targetType: "Bulk",
//           className: { $in: [student.class, "ALL"] },
//           semester: { $in: [student.semester, "ALL"] },
//           section: { $in: [student.section, "ALL"] },
//         },
//       ],
//     }).sort({ createdAt: -1 });

//     res.render("students/messages.ejs", {
//       student,
//       messages,
//       isReplyAllowed,
//     });
//   })
// );

// // Student Reply Route (Respects Admin Global Toggle Permission)
// app.post(
//   "/student/messages/:id/reply",
//   verifySession,
//   isStudentVerified,
//   WrapAsync(async (req, res) => {
//     const settings = await AdminSettings.findOne();
//     if (settings && !settings.studentReplyAllowed) {
//       req.flash("error", "Replying is currently disabled by Admin!");
//       return res.redirect("/student/messages");
//     }

//     const { id } = req.params;
//     const { replyText } = req.body;
//     const msg = await Message.findById(id);

//     msg.replies.push({
//       senderId: req.user._id,
//       senderRole: "Student",
//       senderName: req.user.name,
//       message: replyText,
//     });
//     await msg.save();

//     sendSocketNotification(msg.senderId, "newReply", {
//       title: `Reply from Student ${req.user.name}`,
//       text: replyText,
//     });

//     req.flash("success", "Reply sent successfully!");
//     res.redirect("/student/messages");
//   })
// );

// // Error Handling Middlewares
// app.all("*", (req, res, next) => {
//   next(new ExpressError("Page Not Found", 404));
// });

// app.use((err, req, res, next) => {
//   const { statusCode = 500, message = "Something went wrong" } = err;
//   res.status(statusCode).render("error.ejs", { err });
// });

// // Port Execution
// const PORT = process.env.PORT || 8080;
// server.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT} 🚀`);
// });


//////////////////////

function otpVerify(req, res, next) {
  if (req.session.otpVerify) {
    return next();
  }

  req.flash("error", "Please verify the otp first");
  return res.redirect("/forgot-password");
}

setInterval(
  async () => {
    try {
      // 🔹 All valid student ObjectIds
      const studentIds = await Student.distinct("_id");

      // 🔹 Find orphan attendances
      const orphanAttendances = await Attendance.find({
        studentId: { $nin: studentIds },
      }).select("_id");

      if (orphanAttendances.length === 0) {
        // console.log("✅ No orphan attendance found");
        return;
      }

      // 🔹 Delete only orphans
      const idsToDelete = orphanAttendances.map((a) => a._id);

      const result = await Attendance.deleteMany({
        _id: { $in: idsToDelete },
      });

      console.log(
        `🧹 Deleted ${result.deletedCount} orphan attendance records`,
      );
    } catch (err) {
      console.error("❌ Attendance cleanup error:", err);
    }
  },
   30 * 1000 ,
); 


// to remove feed when student is delete

setInterval(
  async () => {
    try {
      // 🔹 All valid student ObjectIds
      const studentIds = await Student.distinct("_id");

      // 🔹 Find orphan feeds
      const orphanFeeds = await Feed.find({
        studentId: { $nin: studentIds },
      }).select("_id");

      if (orphanFeeds.length === 0) {
        // console.log("✅ No orphan feeds found");
        return;
      }

      // 🔹 Delete only orphan feeds
      const idsToDelete = orphanFeeds.map((f) => f._id);

      const result = await Feed.deleteMany({
        _id: { $in: idsToDelete },
      });

      // console.log(
      //   // `🧹 Deleted ${result.deletedCount} orphan feed records`
      // );
    } catch (err) {
      console.error("❌ Feed cleanup error:", err);
    }
  },
  30 * 1000 ,
); 

// to remove  fess transaction when fess ledger is deleted

setInterval(
  async () => {
    try {
      // 🔹 Step 1: Saari valid/active FeeLedger ki student_id ObjectIds nikalo
      const validLedgerStudentIds = await FeeLedger.distinct("student_id");

      // 🔹 Step 2: Wo FeeTransactions dhoondo jin ki student_id kisi bhi FeeLedger se match nahi karti
      const orphanTransactions = await FeeTransaction.find({
        student_id: { $nin: validLedgerStudentIds },
      }).select("_id");

      // Agar koi orphan transaction nahi milta toh soft return
      if (orphanTransactions.length === 0) {
        // console.log("✅ No orphan transactions found");
        return;
      }

      // 🔹 Step 3: Delete karne ke liye IDs map karo
      const idsToDelete = orphanTransactions.map((t) => t._id);

      // 🔹 Step 4: Delete orphans from FeeTransaction
      const result = await FeeTransaction.deleteMany({
        _id: { $in: idsToDelete },
      });

      console.log(
        `🧹 Deleted ${result.deletedCount} orphan FeeTransaction records (Ledger missing)`,
      );
    } catch (err) {
      console.error("❌ FeeTransaction cleanup error:", err);
    }
  },
  30 * 1000 // Har 2 minute me chalega
);



// 🧹 ClassIncharge Orphan Cleanup Cron Job (Runs every 20 Seconds)
setInterval(
  async () => {
    try {
      // 🔹 Fetch all existing valid Teacher ObjectIds
      const teacherIds = await Teacher.distinct("_id");

      // 🔹 Find ClassIncharge records where teacher doesn't exist anymore
      const orphanIncharges = await ClassIncharge.find({
        teacher: { $nin: teacherIds },
      }).select("_id");

      if (orphanIncharges.length === 0) return;

      // 🔹 Extract IDs and Delete orphan records
      const idsToDelete = orphanIncharges.map((doc) => doc._id);

      const result = await ClassIncharge.deleteMany({
        _id: { $in: idsToDelete },
      });

      // console.log(`🧹 Deleted ${result.deletedCount} orphan ClassIncharge records`);
    } catch (err) {
      console.error("❌ ClassIncharge cleanup error:", err);
    }
  },
  20 * 1000 // 20 Seconds Interval
);

// 🧹 Combined ClassIncharge & HOD Cleanup (Runs every 20 Seconds)
setInterval(
  async () => {
    try {
      // 🔹 Single query for Teacher IDs
      const teacherIds = await Teacher.distinct("_id");

      // 1. Clean Orphan ClassIncharges
      const orphanIncharges = await ClassIncharge.find({
        teacher: { $nin: teacherIds },
      }).select("_id");

      if (orphanIncharges.length > 0) {
        await ClassIncharge.deleteMany({
          _id: { $in: orphanIncharges.map((d) => d._id) },
        });
      }

      // 2. Clean Orphan HODs
      const orphanHods = await Hod.find({
        teacher: { $nin: teacherIds },
      }).select("_id");

      if (orphanHods.length > 0) {
        await Hod.deleteMany({
          _id: { $in: orphanHods.map((d) => d._id) },
        });
      }
    } catch (err) {
      console.error("❌ Teacher Incharge/HOD cleanup error:", err);
    }
  },
  20 * 1000
);






console.log("Mongo URL:", process.env.ATLASDB_URL);

// users login

app.get("/student/attendance/login", (req, res) => {
  res.render("users/login.ejs");
});


// =========================================================================
// 🔄 BULLETPROOF PASSPORT & SESSION PURGE HELPER (SAME BROWSER RESET)
// =========================================================================
const purgePreviousSession = (req, callback) => {
  // 1. Force Passport logout for the current browser session
  if (typeof req.logout === "function") {
    req.logout((err) => {
      if (err) console.error("Passport logout error during session purge:", err);

      // 2. Regenerate Express Session ID to completely destroy old keys in this browser
      req.session.regenerate((regenErr) => {
        if (regenErr) console.error("Session Regenerate Error:", regenErr);
        return callback();
      });
    });
  } else {
    req.session.regenerate((regenErr) => {
      if (regenErr) console.error("Session Regenerate Error:", regenErr);
      return callback();
    });
  }
};

// =========================================================================
// 🔑 1. MAIN ATTENDANCE LOGIN ROUTE
// =========================================================================
app.post(
  "/student/attendance/login",
  WrapAsync(async (req, res) => {
    const { role, username, password } = req.body || {};

    const adminRole = process.env.ROLE_1 || "Admin";
    const teacherRole = process.env.ROLE_2 || "Teacher";
    const studentRole = process.env.ROLE_3 || "Student";

    // 🔴 ROLE VALIDATION & TRIMMING
    if (!role || !username || !password) {
      req.flash("error", "All fields are required.");
      return res.redirect("/student/attendance/login");
    }

    const cleanUsername = String(username).trim();
    const cleanPassword = String(password).trim();

    // =========================================================================
    // 👑 1. ADMIN LOGIN
    // =========================================================================
    if (role === adminRole) {
      let admin = await Admin.findOne({ username: cleanUsername }).select("+password");

      if (!admin) {
        req.flash("error", "Invalid username or password");
        return res.redirect("/student/attendance/login");
      }

      let isMatch = false;
      if (admin.password) {
        try {
          isMatch = await bcrypt.compare(cleanPassword, admin.password);
        } catch (bcryptErr) {
          isMatch = admin.password === cleanPassword;
        }
      }

      if (!isMatch) {
        req.flash("error", "Invalid username or password");
        return res.redirect("/student/attendance/login");
      }

      if (admin.status === "Blocked") {
        req.flash("error", "Your account is blocked. Please contact super admin.");
        return res.redirect("/student/attendance/login");
      }

      // 🔴 PURGE OLD TEACHER/STUDENT SESSION IN SAME BROWSER BEFORE CREATING ADMIN SESSION
      return purgePreviousSession(req, () => {
        req.session.adminVerified = true;
        req.session.userId = admin._id.toString();
        req.session.role = adminRole;
        req.session.loginTime = new Date().toISOString();

        req.session.save((err) => {
          if (err) console.error("Session Save Error:", err);
          req.flash("success", "Login successfully");
          return res.redirect("/admin/student/attendance");
        });
      });
    }

    // =========================================================================
    // 👨‍🏫 2. TEACHER LOGIN REDIRECT
    // =========================================================================
    if (role === teacherRole) {
      // 307 Redirect for Modal POST handling
      return res.redirect(307, "/login/modal");
    }

    // =========================================================================
    // 🎓 3. STUDENT LOGIN
    // =========================================================================
    if (role === studentRole) {
      const rollNoNum = parseInt(cleanUsername, 10);
      if (isNaN(rollNoNum)) {
        req.flash("error", "Invalid username or password");
        return res.redirect("/student/attendance/login");
      }

      const student = await Student.findOne({ rollNo: rollNoNum }).select("+password");

      if (!student) {
        req.flash("error", "Invalid username or password");
        return res.redirect("/student/attendance/login");
      }

      let isPasswordValid = false;
      try {
        isPasswordValid = await bcrypt.compare(cleanPassword, student.password);
      } catch (bcryptErr) {
        isPasswordValid = student.password === cleanPassword;
      }

      if (!isPasswordValid) {
        req.flash("error", "Invalid username or password");
        return res.redirect("/student/attendance/login");
      }

      if (student.status === "Blocked") {
        req.flash("error", "Your account is blocked. Please contact admin.");
        return res.redirect("/student/attendance/login");
      }

      // 🔴 PURGE OLD TEACHER/ADMIN SESSION IN SAME BROWSER BEFORE CREATING STUDENT SESSION
      return purgePreviousSession(req, () => {
        req.session.userId = student._id.toString();
        req.session.studentId = student._id.toString();
        req.session.rollNo = student.rollNo;
        req.session.role = studentRole;
        req.session.loginTime = new Date().toISOString();

        if (student.check !== "update") {
          req.session.otpVerified = false;
          return req.session.save((err) => {
            if (err) console.error("Session Save Error:", err);
            return res.redirect("/student/update/password");
          });
        }

        req.session.otpVerified = true;

        return req.session.save((err) => {
          if (err) console.error("Session Save Error:", err);
          req.flash("success", "Login Successfully");
          return res.redirect("/student/attendance");
        });
      });
    }

    // =========================================================================
    // ❌ 4. INVALID ROLE FALLBACK
    // =========================================================================
    req.flash("error", "Role not matched");
    return res.redirect("/student/attendance/login");
  })
);

// =========================================================================
// 👨‍🏫 2. TEACHER PASSPORT MODAL AUTH ROUTE (BUG 2 FIXED)
// =========================================================================
app.post("/login/modal", (req, res, next) => {
  // 🔴 1. PURGE PREVIOUS PASSPORT AUTH BEFORE ATTEMPTING NEW LOGIN
  if (typeof req.logout === "function") {
    req.logout((err) => {
      if (err) console.error("Logout error in modal purge:", err);
    });
  }

  passport.authenticate("local", (err, teacher, info) => {
    if (err) {
      console.error("Passport Auth Error:", err);
      req.flash("error", "Something went wrong during authentication.");
      return res.redirect("/student/attendance/login");
    }

    // 🔴 2. INVALID CREDENTIALS
    if (!teacher) {
      req.flash("error", info?.message || "Invalid username or password");
      return res.redirect("/student/attendance/login");
    }

    // 🔴 3. BLOCKED TEACHER CHECK
    if (teacher.status === "Blocked") {
      req.flash("error", "Your account is blocked by administrator. Access denied.");
      return res.redirect("/student/attendance/login");
    }

    // 🔴 4. PASSPORT REQ.LOGIN EXECUTION
    req.logIn(teacher, (loginErr) => {
      if (loginErr) {
        console.error("Req Login Error:", loginErr);
        req.flash("error", "Failed to initialize session.");
        return res.redirect("/student/attendance/login");
      }

      const teacherRole = process.env.ROLE_2 || "Teacher";

      // 🔴 5. CLEAN ALL PREVIOUS ROLE KEYS & ASSIGN TEACHER SESSION
      delete req.session.adminVerified;
      delete req.session.otpVerified;
      delete req.session.rollNo;
      delete req.session.studentId;

      req.session.userId = teacher._id.toString();
      req.session.role = teacherRole;
      req.session.loginTime = new Date().toISOString();

      // 🔴 6. SAVE SESSION BEFORE REDIRECT
      return req.session.save((saveErr) => {
        if (saveErr) console.error("Session Save Error:", saveErr);
        req.flash("success", `Welcome back, ${teacher.name}!`);
        return res.redirect("/teacher/student/attendance");
      });
    });
  })(req, res, next);
});



// ================= 1. FORGOT PASSWORD GET & POST =================

app.get(
  "/forgot-password",
  WrapAsync(async (req, res) => {
    res.render("admin/forgetpassword.ejs");
  }),
);

app.post(
  "/forgot-password",
  WrapAsync(async (req, res) => {
    const SibApiV3Sdk = require("sib-api-v3-sdk");
    const { role, username } = req.body;

    const adminRole = process.env.ROLE_1;
    const teacherRole = process.env.ROLE_2;
    const studentRole = process.env.ROLE_3;

    let user = null;
    let userType = "";

    // Role-based User Fetching
    if (role === adminRole) {
      user = await Admin.findOne({ username: username.trim() });
      userType = "Admin";
    } else if (role === teacherRole) {
      user = await Teacher.findOne({ username: username.trim() });
      userType = "Teacher";
    } else if (role === studentRole) {
      const rollNo = parseInt(username);
      if (!isNaN(rollNo)) {
        user = await Student.findOne({ rollNo: rollNo });
      }
      userType = "Student";
    } else {
      req.flash("error", "Invalid role selected.");
      return res.redirect("/forgot-password");
    }

    if (!user) {
      req.flash("error", "Enter a valid username.");
      return res.redirect("/forgot-password");
    }

    if (user.status === "Blocked") {
      req.flash(
        "error",
        "Your account has been blocked. Please contact the administrator.",
      );
      return res.redirect("/forgot-password");
    }

    if (!user.email || user.email.trim() === "") {
      req.flash(
        "error",
        "Email not found for this account. Please contact support.",
      );
      return res.redirect("/forgot-password");
    }

    // 🔴 FIX 1: Guaranteed 6-Digit String OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP to DB
    await OTP.deleteMany({ userId: user._id });
    const newOtp = new OTP({
      userId: user._id,
      otp: otp,
      createdAt: new Date(),
    });
    await newOtp.save();

    // Set Session Variables
    req.session.role = role;
    req.session.email = user.email;
    req.session.userId = user._id.toString();
    req.session.otpVerify = false;

    // 🔴 FIX 2: FORCE SESSION SAVE BEFORE REDIRECT
    req.session.save(async (err) => {
      if (err) {
        console.error("Session Save Error:", err);
        req.flash("error", "Session creation failed. Please try again.");
        return res.redirect("/forgot-password");
      }

      // Brevo Email Delivery Execution
      try {
        const client = SibApiV3Sdk.ApiClient.instance;
        const apiKey = client.authentications["api-key"];
        apiKey.apiKey = process.env.BREVO_API_KEY;

        const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();
        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

        sendSmtpEmail.subject = "Attendance Verification Code";
        sendSmtpEmail.htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #4f46e5; text-align: center;">Attendance OTP</h2>
                <p>Hello ${user.name || userType},</p>
                <p>Your verification code for resetting the password is:</p>
                <div style="background: #f8fafc; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
                    <h1 style="letter-spacing: 8px; color: #1e1b4b; margin: 0;">${otp}</h1>
                </div>
                <p style="color: #64748b; font-size: 0.85rem; text-align: center;">This OTP is valid for short duration.</p>
            </div>
        `;

        sendSmtpEmail.sender = {
          name: "Attendance System",
          email: process.env.EMAIL_USER,
        };

        sendSmtpEmail.to = [
          {
            email: user.email,
            name: user.name || userType,
          },
        ];

        await tranEmailApi.sendTransacEmail(sendSmtpEmail);
        return res.redirect("/otp");
      } catch (mailErr) {
        console.error("Brevo Mail Error:", mailErr);
        req.flash(
          "error",
          "OTP sending failed. Please check IP Whitelisting or Brevo API Key.",
        );
        return res.redirect("/forgot-password");
      }
    });
  }),
);

// ================= 2. OTP PAGE & VERIFICATION =================

app.get("/otp", (req, res) => {
  const email = req.session.email;

  if (!email) {
    req.flash("error", "Session expired. Please enter your details again.");
    return res.redirect("/forgot-password");
  }
  res.render("listings/otp.ejs", { email });
});

app.post(
  "/verify-otp",
  WrapAsync(async (req, res) => {
    const { otp } = req.body || {};
    const userId = req.session.userId;

    if (!userId) {
      req.flash("error", "Session expired. Please request OTP again.");
      return res.redirect("/forgot-password");
    }

    // Clean String Comparison
    const cleanOtp = String(otp).trim();
    let otpRecord = await OTP.findOne({ otp: cleanOtp, userId: userId });

    if (otpRecord) {
      await OTP.deleteOne({ _id: otpRecord._id });

      // 🔴 FIX 3: OTP Verified Flag Set & Force Save Session
      req.session.otpVerify = true;

      req.session.save((err) => {
        if (err) console.error("Session Save Error on Verify:", err);
        return res.redirect("/new/password");
      });
    } else {
      req.flash("error", "Invalid OTP or expired!");
      return res.redirect("/otp");
    }
  }),
);

// ================= 3. NEW PASSWORD & SAVE =================

app.get("/new/password", otpVerify, (req, res) => {
  res.render("admin/newpassword.ejs");
});

app.put(
  "/save/new/password",
  otpVerify,
  WrapAsync(async (req, res) => {
    const { password } = req.body;
    const userId = req.session.userId;
    const userRole = req.session.role;

    const adminRole = process.env.ROLE_1 || "Admin";
    const teacherRole = process.env.ROLE_2 || "Teacher";
    const studentRole = process.env.ROLE_3 || "Student";

    if (!userId) {
      req.flash(
        "error",
        "Unauthorized access or session expired. Please verify OTP again.",
      );
      return res.redirect("/forgot-password");
    }

    // Password Validation
    const hasNumberOrSpecial = /[\d!@#$%^&*(),.?":{}|<>_]/.test(password);
    if (!password || password.length < 8 || !hasNumberOrSpecial) {
      req.flash(
        "error",
        "Password must be at least 8 characters long and contain at least one number or special character.",
      );
      return res.redirect("/new/password");
    }

    let passwordUpdated = false;
    let targetUser = null;

    if (userRole === adminRole) {
      targetUser = await Admin.findById(userId);
    } else if (userRole === studentRole || userRole === "Student") {
      targetUser = await Student.findById(userId);
    } else if (userRole === teacherRole || userRole === "Teacher") {
      targetUser = await Teacher.findById(userId);
    } else {
      targetUser =
        (await Student.findById(userId)) ||
        (await Teacher.findById(userId)) ||
        (await Admin.findById(userId));
    }

    if (!targetUser) {
      req.flash("error", "User record not found in database.");
      return res.redirect("/forgot-password");
    }

    if (targetUser.status === "Blocked") {
      req.session.destroy();
      req.flash("error", "Your account is blocked. Password reset aborted.");
      return res.redirect("/forgot-password");
    }

    const modelName = targetUser.constructor.modelName;

    if (modelName === "Student" || modelName === "Admin") {
      targetUser.password = password;
      targetUser.passwordChangedAt = new Date();
      await targetUser.save(); // pre('save') hook bcrypts this
      passwordUpdated = true;
    } else if (modelName === "Teacher") {
      if (typeof targetUser.setPassword === "function") {
        await targetUser.setPassword(password);
        targetUser.passwordChangedAt = new Date();
        await targetUser.save();
        passwordUpdated = true;
      }
    }

    if (passwordUpdated) {
      // Clear OTP Flow Session Vars
      req.session.email = null;
      req.session.userId = null;
      req.session.role = null;
      req.session.otpVerify = false;

      req.session.save((err) => {
        req.flash(
          "success",
          "Password changed successfully! Please login with your new password.",
        );
        return res.redirect("/student/attendance/login");
      });
    } else {
      req.flash("error", "Failed to update password. Please try again.");
      return res.redirect("/forgot-password");
    }
  }),
);

// app.get(
//   "/forgot-password",
//   WrapAsync(async (req, res) => {
//     res.render("admin/forgetpassword.ejs");
//   }),
// );

// app.post(
//   "/forgot-password",
//   WrapAsync(async (req, res) => {
//     const SibApiV3Sdk = require("sib-api-v3-sdk");
//     const { role, username } = req.body;

//    const adminRole =   process.env.ROLE_1;
//     const teacherRole = process.env.ROLE_2;
//     const studentRole = process.env.ROLE_3;

//     let user = null;
//     let userType = "";

//     // ================= 1. USER VALIDATION (ROLE BASED) =================

//     if (role === adminRole) {
//       user = await Admin.findOne({ username: username });
//       userType = "Admin";
//    }
//     else if (role === teacherRole) {
//       user = await Teacher.findOne({ username: username });
//       userType = "Teacher";
//     } else if (role === studentRole) {
//       const rollNo = parseInt(username);
//       if (!isNaN(rollNo)) {
//         user = await Student.findOne({ rollNo: rollNo });
//       }
//       userType = "Student";
//     } else {
//       req.flash("error", "Invalid role selected.");
//       return res.redirect("/forgot-password");
//     }

//     // Agar user database me mila hi nahi
//     if (!user) {
//       req.flash("error", "Enter a valid username");
//       return res.redirect("/forgot-password");
//     }

//      if (user.status === "Blocked") {
//       req.flash(
//         "error",
//         "Your account has been blocked. Please contact the administrator."
//       );
//       return res.redirect("/forgot-password");
//     }

//     // 🔥 NEW ADD-ON: Agar user mil gaya par uska EMAIL missing ya khaali hai
//     if (!user.email || user.email.trim() === "") {
//       req.flash(
//         "error",
//         "Email not found for this account. Please enter your email or contact support.",
//       );
//       return res.redirect("/forgot-password");
//     }

//     // Session variables set karna
//     req.session.role = role;
//     req.session.email = user.email;
//     req.session.userId = user._id;
//     req.session.otpVerify = false;

//     // ================= 2. OTP GENERATION =================
//     let otp = "";
//     for (let i = 0; i < 6; i++) {
//       otp += Math.floor(Math.random() * 10);
//     }

//     await OTP.deleteMany({ userId: user._id });
//     const newOtp = new OTP({
//       userId: user._id,
//       otp,
//       createdAt: new Date(),
//     });
//     await newOtp.save();

//     // ================= 3. BREVO EMAIL SENDING SETUP =================
//     const client = SibApiV3Sdk.ApiClient.instance;
//     const apiKey = client.authentications["api-key"];
//     apiKey.apiKey = process.env.BREVO_API_KEY;

//     const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();
//     const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

//     sendSmtpEmail.subject = "Attendance Verification Code";
//     sendSmtpEmail.htmlContent = `
//         <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
//             <h2 style="color: #4f46e5; text-align: center;">Attendance OTP</h2>
//             <p>Hello ${user.name || userType},</p>
//             <p>Your verification code for resetting the password is:</p>
//             <div style="background: #f8fafc; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
//                 <h1 style="letter-spacing: 8px; color: #1e1b4b; margin: 0;">${otp}</h1>
//             </div>
//             <p style="color: #64748b; font-size: 0.85rem; text-align: center;">This OTP is valid for 30 seconds.</p>
//         </div>
//     `;

//     sendSmtpEmail.sender = {
//       name: "Attendance System",
//       email: process.env.EMAIL_USER,
//     };

//     sendSmtpEmail.to = [
//       {
//         email: user.email,
//         name: user.name || userType,
//       },
//     ];

//     // ================= 4. EMAIL SENDING EXECUTOR =================
//     try {
//       await tranEmailApi.sendTransacEmail(sendSmtpEmail);
//     } catch (mailErr) {
//       console.error("Brevo Mail Error:", mailErr);
//       req.flash(
//         "error",
//         "OTP sending failed. Please check IP Whitelisting or API Key.",
//       );
//       return res.redirect("/forgot-password");
//     }

//     return res.redirect("/otp");
//   }),
// );

// //otp

// app.get("/otp", (req, res) => {
//   const email = req.session.email;

//   if (!email) {
//     req.flash("error", "Session expired. Please enter your details again.");
//     return res.redirect("/forgot-password");
//   }
//   res.render("listings/otp.ejs", { email });
// });

// app.post(
//   "/verify-otp",
//   WrapAsync(async (req, res) => {
//     const { otp } = req.body;
//     const userId = req.session.userId; // Session se userId nikali

//     if (!userId) {
//       req.flash("error", "Session expired. Please try again.");
//       return res.redirect("/forgot-password");
//     }

//     let otpRecord = await OTP.findOne({ otp: otp, userId: userId });

//     if (otpRecord) {
//       await OTP.deleteOne({ _id: otpRecord._id });
//       req.session.otpVerify = true;
//       return res.redirect("/new/password");
//     } else {
//       req.flash("error", "Invalid OTP or expired!");
//       return res.redirect("/otp");
//     }
//   }),
// );

// // new password

// app.get("/new/password", otpVerify, (req, res) => {
//   res.render("admin/newpassword.ejs");
// });

// app.put(
//   "/save/new/password",otpVerify,
//   WrapAsync(async (req, res) => {
//     const { password } = req.body;
//     const userId = req.session.userId;
//     const userRole = req.session.role; // 'Admin', 'Teacher', ya 'Student'

//     const adminRole = process.env.ROLE_1 || "Admin";
//     const teacherRole = process.env.ROLE_2 || "Teacher";
//     const studentRole = process.env.ROLE_3 || "Student";

//     // 🔴 BUG FIX 1: SESSION & OTP VERIFICATION CHECK
//     if (!userId) {
//       req.flash(
//         "error",
//         "Unauthorized access or session expired. Please verify OTP again."
//       );
//       return res.redirect("/forgot-password");
//     }

//     // 🔐 2. PASSWORD STRENGTH VALIDATION
//     const hasNumberOrSpecial = /[\d!@#$%^&*(),.?":{}|<>_]/.test(password);
//     if (!password || password.length < 8 || !hasNumberOrSpecial) {
//       req.flash(
//         "error",
//         "Password must be at least 8 characters long and contain at least one number or special character."
//       );
//       return res.redirect("/new/password");
//     }

//     let passwordUpdated = false;
//     let targetUser = null;

//     // 🔴 3. USER FETCHING LOGIC
//     if (userRole === adminRole) {
//       targetUser = await Admin.findById(userId);
//     } else if (userRole === studentRole || userRole === "Student") {
//       targetUser = await Student.findById(userId);
//     } else if (userRole === teacherRole || userRole === "Teacher") {
//       targetUser = await Teacher.findById(userId);
//     } else {
//       // Fallback Search
//       targetUser =
//         (await Student.findById(userId)) ||
//         (await Teacher.findById(userId)) ||
//         (await Admin.findById(userId));
//     }

//     // 🔴 4. USER EXISTENCE & BLOCKED STATUS CHECK
//     if (!targetUser) {
//       req.flash("error", "User record not found in database.");
//       return res.redirect("/forgot-password");
//     }

//     if (targetUser.status === "Blocked") {
//       req.session.email = null;
//       req.session.userId = null;
//       req.session.role = null;
//       req.session.otpVerify = false;
//       req.flash("error", "Your account is blocked. Password reset aborted.");
//       return res.redirect("/forgot-password");
//     }

//     // 🔴 5. SAFE PASSWORD SAVE LOGIC
//     const modelName = targetUser.constructor.modelName;

//     // Case A: Student ya Admin (Uses Mongoose pre('save') bcrypt hook)
//     if (modelName === "Student" || modelName === "Admin") {
//       targetUser.password = password;
//       targetUser.passwordChangedAt = new Date();
//       await targetUser.save(); // Triggers Mongoose pre("save") bcrypt hashing hook
//       passwordUpdated = true;
//     }
//     // Case B: Teacher (Uses Passport-Local-Mongoose plugin method)
//     else if (modelName === "Teacher") {
//       if (typeof targetUser.setPassword === "function") {
//         await targetUser.setPassword(password);
//         if ("passwordChangedAt" in targetUser) {
//           targetUser.passwordChangedAt = new Date();
//         }
//         await targetUser.save();
//         passwordUpdated = true;
//       }
//     }

//     // 🔴 6. SESSION CLEANUP & FINAL REDIRECT
//     if (passwordUpdated) {
//       req.session.email = null;
//       req.session.userId = null;
//       req.session.role = null;
//       req.session.otpVerify = false;
//       req.flash(
//         "success",
//         "Password changed successfully! Please login with your new password.",
//       );
//       return res.redirect("/student/attendance/login");
//     } else {
//       req.flash("error", "User record not found in database.");
//       return res.redirect("/forgot-password");
//     }
//   }),
// );

// ye naaya hai lakin update logic se nahi banaa hua hai

// app.put(
//   "/save/new/password",otpVerify,
//   WrapAsync(async (req, res) => {
//     const { password } = req.body;
//     const userId = req.session.userId;
//     const userRole = req.session.role;

//     const adminRole = process.env.ROLE_1;
//     const teacherRole = process.env.ROLE_2;
//     const studentRole = process.env.ROLE_3;

//     if (!userId) {
//       req.flash(
//         "error",
//         "Session expired. Please start from forgot password."
//       );
//       return res.redirect("/forgot-password");
//     }

//     // Password criteria validation
//     const hasNumberOrSpecial = /[\d!@#$%^&*(),.?":{}|<>_]/.test(password);
//     if (!password || password.length < 8 || !hasNumberOrSpecial) {
//       req.flash(
//         "error",
//         "Password must be at least 8 characters long and contain at least one number or special character."
//       );
//       return res.redirect("/new/password");
//     }

//     let passwordUpdated = false;

//     // 1. ADMIN UPDATE (Uses mongoose pre-save hook for bcrypt)
//     if (userRole === adminRole) {
//       let adminObj = await Admin.findById(userId);
//       if (adminObj) {
//         adminObj.password = password; // pre('save') hook will hash this password
//         await adminObj.save();
//         passwordUpdated = true;
//       }
//     }
//     // 2. TEACHER UPDATE (passport-local-mongoose implementation)
//     else if (userRole === teacherRole) {
//       let teacherObj = await Teacher.findById(userId);
//       if (teacherObj) {
//         await teacherObj.setPassword(password);
//         await teacherObj.save();
//         passwordUpdated = true;
//       }
//     }
//     // 3. STUDENT UPDATE (Uses mongoose pre-save hook for bcrypt)
//     else if (userRole === studentRole) {
//       let studentObj = await Student.findById(userId);
//       if (studentObj) {
//         studentObj.password = password; // Save call so pre-save hook fires
//         await studentObj.save();
//         passwordUpdated = true;
//       }
//     }
//     // 4. FALLBACK LOGIC (In case req.session.role fails/expires)
//     else {
//       let adminObj = await Admin.findById(userId);
//       if (adminObj) {
//         adminObj.password = password;
//         await adminObj.save();
//         passwordUpdated = true;
//       } else {
//         let teacherObj = await Teacher.findById(userId);
//         if (teacherObj) {
//           await teacherObj.setPassword(password);
//           await teacherObj.save();
//           passwordUpdated = true;
//         } else {
//           let studentObj = await Student.findById(userId);
//           if (studentObj) {
//             studentObj.password = password;
//             await studentObj.save();
//             passwordUpdated = true;
//           }
//         }
//       }
//     }

//     // ================= SESSIONS RESET & CLEANUP =================
//     if (passwordUpdated) {
//       req.session.email = null;
//       req.session.userId = null;
//       req.session.role = null;
//       req.session.otpVerify = false;

//       req.flash(
//         "success",
//         "Password changed successfully! Please login with your new password.",
//       );
//       return res.redirect("/student/attendance/login");
//     } else {
//       req.flash("error", "User record not found in database.");
//       return res.redirect("/forgot-password");
//     }
//   }),
// );

// save new password   PURANA HAI JO STUDENT TEACHER KE LIYE KAAM KARTA THA

// app.put(
//   "/save/new/password",
//   WrapAsync(async (req, res) => {
//     const { password } = req.body;
//     const userId = req.session.userId;
//     const userRole = req.session.role; // 'Student' ya 'Teacher'
//     console.log(userRole, userId);

//     if (!userId) {
//       req.flash(
//         "error",
//         "Session expired. Please try again from forgot password.",
//       );
//       return res.redirect("/forgot-password");
//     }

//     const hasNumberOrSpecial = /[\d!@#$%^&*(),.?":{}|<>_]/.test(password);
//     if (!password || password.length < 8 || !hasNumberOrSpecial) {
//       req.flash("error", "Password must be at least 8 characters long and contain at least one number or special character");
//       return res.redirect("/new/password");
//     }

//     let passwordUpdated = false;
//      let targetUser = null;

//     // 🔴 2. USER FETCH BASED ON ROLE
//     if (userRole === adminRole) {
//       targetUser = await Admin.findById(userId);
//     } else if (userRole === studentRole || userRole === "Student") {
//       targetUser = await Student.findById(userId);
//     } else if (userRole === teacherRole || userRole === "Teacher") {
//       targetUser = await Teacher.findById(userId);
//     } else {
//       // Fallback: Agar session me role miss ho jaye, toh teeno collections me search karo
//       targetUser =
//         (await Student.findById(userId)) ||
//         (await Teacher.findById(userId)) ||
//         (await Admin.findById(userId));
//     }

//     // 🔴 3. USER EXISTENCE & BLOCKED STATUS CHECK
//     if (!targetUser) {
//       req.flash("error", "User record not found in database.");
//       return res.redirect("/forgot-password");
//     }

//     if (targetUser.status === "Blocked") {
//       req.session.email = null;
//       req.session.userId = null;
//       req.session.role = null;
//       req.flash("error", "Your account is blocked. Password change aborted.");
//       return res.redirect("/forgot-password");
//     }

//     if (userRole === adminRole) {
//       let adminObj = await Admin.findById(userId);
//       if (adminObj) {
//         adminObj.password = password; // pre('save') hook will hash this password
//         await adminObj.save();
//         passwordUpdated = true;
//       }
//     }

//     else if (userRole === "Student") {
//       let student = await Student.findByIdAndUpdate(userId, {
//         password: password,
//       });
//       if (student) passwordUpdated = true;
//     }
//      else if (userRole === "Teacher") {
//       let teacher = await Teacher.findById(userId);
//       if (teacher && password && password.trim() !== "") {
//         await teacher.setPassword(password);
//         await teacher.save();
//         passwordUpdated = true;
//       }
//     } else {
//       // Fallback: Agar session me role miss ho jaye, toh pehle Student me dhoondo
//       let studentObj = await Student.findByIdAndUpdate(userId, {
//         password: password,
//       });
//       if (studentObj) {
//         passwordUpdated = true;
//       } else {
//         // Agar student nahi mila, toh Teacher me passport-local-mongoose lagaon
//         let teacherObj = await Teacher.findById(userId);
//         if (teacherObj && password && password.trim() !== "") {
//           await teacherObj.setPassword(password);
//           await teacherObj.save();
//           passwordUpdated = true;
//         }
//       }
//     }

//     // 4. 🔥 SAARE SESSION KO NULL KARO KAAM KHATAM HONE KE BAAD
//     if (passwordUpdated) {
//       req.session.email = null;
//       req.session.userId = null;
//       req.session.role = null;

//       req.flash(
//         "success",
//         "Password changed successfully! Please login with your new password.",
//       );
//       return res.redirect("/student/attendance/login");
//     } else {
//       req.flash("error", "User record not found in database.");
//       return res.redirect("/forgot-password");
//     }
//   }),
// );

// resend otp

app.post(
  "/resend-otp",
  WrapAsync(async (req, res) => {
    const email = req.session.email;
    const userId = req.session.userId;
    const userRole = req.session.role; // 'student' ya 'teacher'

    if (!email || !userId) {
      return res.status(400).json({
        success: false,
        message: "Session expired. Please try again.",
      });
    }

    // 1. Database se User ka real Name nikalne ka jugaad
    let userName = userRole || "User"; // Default fallback naam

    // Student collection me check karo (Apne Model ka sahi naam dekh lena, e.g., Student ya User)

    let userObj = await Student.findById(userId);
    if (userObj) {
      userName = userObj.name;
    } else {
      userObj = await Teacher.findById(userId);
      if (userObj) {
        userName = userObj.name;
      } else {
        userObj = await Admin.findById(userId);
        if (userObj) {
          userName = userObj.name;
        }
      }
    }

    let otp = "";
    for (let i = 0; i < 6; i++) {
      otp += Math.floor(Math.random() * 10);
    }

    await OTP.deleteMany({ userId: userId });

    const newOtp = new OTP({
      userId: userId,
      otp,
      createdAt: new Date(),
    });
    await newOtp.save();

    // ================= 4. BREVO EMAIL SENDING SETUP =================
    const SibApiV3Sdk = require("sib-api-v3-sdk");

    const client = SibApiV3Sdk.ApiClient.instance;
    const apiKey = client.authentications["api-key"];
    apiKey.apiKey = process.env.BREVO_API_KEY;

    const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    sendSmtpEmail.subject = "Attendance Verification Code";
    sendSmtpEmail.htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #4f46e5; text-align: center;">Attendance OTP</h2>
            <p>Hello ${userName},</p>
            <p>Your new verification code for resetting the password is:</p>
            <div style="background: #f8fafc; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
                <h1 style="letter-spacing: 8px; color: #1e1b4b; margin: 0;">${otp}</h1>
            </div>
            <p style="color: #64748b; font-size: 0.85rem; text-align: center;">This OTP is valid for 30 seconds.</p>
        </div>
    `;

    sendSmtpEmail.sender = {
      name: "Attendance System",
      email: process.env.EMAIL_USER,
    };

    sendSmtpEmail.to = [
      {
        email: email,
        name: userName,
      },
    ];

    // ================= 5. EMAIL SENDING EXECUTOR =================
    try {
      await tranEmailApi.sendTransacEmail(sendSmtpEmail);
      return res.json({ success: true, message: "New OTP sent successfully!" });
    } catch (mailErr) {
      return res
        .status(500)
        .json({ success: false, message: "Failed to send email via Brevo." });
    }
  }),
);

// excel import data

app.get("/excel/import", verifySession, isAdminVerified, (req, res) => {
  res.render("admin/importPage");
});

app.post(
  "/excel/import",
  verifySession, isAdminVerified,
  uploadBuffer.single("studentFile"),
  WrapAsync(async (req, res) => {
    try {
      if (!req.file) {
        req.flash("error", "Please select an Excel or CSV file to upload.");
        return res.redirect("/excel/import");
      }

      // Read Excel file directly from RAM memory buffer
      const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const jsonArray = xlsx.utils.sheet_to_json(
        workbook.Sheets[firstSheetName],
      );

      if (!jsonArray || jsonArray.length === 0) {
        req.flash(
          "error",
          "The uploaded Excel file does not contain any data.",
        );
        return res.redirect("/excel/import");
      }

      // Helper function to handle case-insensitive headers and trim extra spaces
      const getFieldValue = (row, targetKey) => {
        const foundKey = Object.keys(row).find(
          (key) => key.trim().toLowerCase() === targetKey.toLowerCase(),
        );
        return foundKey ? String(row[foundKey]).trim() : null;
      };

      const studentDataToInsert = [];

      for (let row of jsonArray) {
        const roll =
          getFieldValue(row, "rollNo") || getFieldValue(row, "rollno");
        const sName = getFieldValue(row, "name");
        const fName =
          getFieldValue(row, "fatherName") || getFieldValue(row, "fathername");
        const sec = getFieldValue(row, "section");
        const cls = getFieldValue(row, "class");
        const sess = getFieldValue(row, "session");
        const sem = getFieldValue(row, "semester");

        // Process row only if the minimum required fields (rollNo and name) are present
        if (roll && sName) {
          const rawPassword = getFieldValue(row, "password") || String(roll);

          // 🔒 Manual Bcrypt Hash (Kyunki insertMany pre-save hooks run nahi karta)
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(rawPassword, salt);

          studentDataToInsert.push({
            rollNo: Number(roll),
            name: sName,
            fatherName: fName || "N/A",
            section: sec || "A",
            class: cls || "N/A",
            session: sess || "N/A",
            semester: String(sem || "1"),

            // Dynamic Fallbacks and System Defaults
            // password: getFieldValue(row, "password") || String(roll),
            password: hashedPassword,
            passwordChangedAt: new Date(),
            email: getFieldValue(row, "email") || `${roll}@acet.edu.in`,
            image: {
              url: "https://res.cloudinary.com/dkgfuzi7n/image/upload/v1700000000/default-avatar.png",
              filename: "default-avatar",
            },
            status: "Active",
          });
        }
      }

      if (studentDataToInsert.length === 0) {
        req.flash(
          "error",
          "Required columns ('rollNo' and 'name') match not found. Please check Excel headers.",
        );
        return res.redirect("/excel/import");
      }

      // Bulk insert cleaned data into MongoDB
      await Student.insertMany(studentDataToInsert);

      req.flash(
        "success",
        "Excellent! All student data has been imported successfully.",
      );
      res.redirect("/add/studentData");
    } catch (error) {
      // console.error("❌ IMPORT ERROR:", error);

      // Handle Duplicate Key Error (MongoDB Unique Constraint)
      if (error.code === 11000) {
        req.flash(
          "error",
          "Import failed! One or more Admin Numbers already exist in the database.",
        );
        return res.redirect("/excel/import");
      }

      req.flash("error", "Something went wrong while importing data.");
      res.redirect("/excel/import");
    }
  }),
);

//  admin main route

app.get(
  "/admin/student/attendance",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let teacherData = await Teacher.find({});
    let classData = await Class.find({});
    let subjectData = await Subject.find({});
    let studentData = await Student.find({});
    let sectionData = await Section.find({});

    res.render("admin/main.ejs", {
      teacherData,
      classData,
      subjectData,
      studentData,
      sectionData,
    });
  }),
);

// // logout admin
// app.get("/admin/logout", verifiedAny, (req, res) => {
//   req.session.adminVerified = false;
//   req.flash("success", "Logout successfuly");
//   res.redirect("/student/attendance/login");
// });

// search box teacher
app.post(
  "/search/teacher",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { search } = req.body;
    let datas = await Teacher.find({
      name: { $regex: search, $options: "i" },
    });
    if (datas.length === 0) {
      req.flash("error", "Teacher not found!");
      res.redirect("/show/teacher");
    } else {
      res.render("admin/searchTeacher.ejs", { datas });
    }
  }),
);

// teachers

// add teacherData
app.get("/add/teacherData",  verifySession, isAdminVerified, (req, res) => {
  res.render("admin/createTeacher.ejs");
});

// app.post(
//   "/add/teacherData",
//   verifiedAny,
//   upload.single("data[image]"),
//   validateTeacher,
//   WrapAsync(async (req, res, next) => {

//     try {
//       const { data } = req.body;

//       const newTeacher = new Teacher(data);

//       // ✅ IMAGE OPTIONAL (safe)
//       if (req.file) {
//         newTeacher.image = {
//           url: req.file.path,
//           filename: req.file.filename
//         };
//       }

//       const registerUser = await Teacher.register(newTeacher, data.password);

//       req.login(registerUser, (err) => {
//         if (err) return next(err);

//        if (!req.session.adminVerified) {
//                 req.session.adminVerified = true;
//               }
//               req.flash("success", "Add Teacher successfully");
//               res.redirect("/add/teacherData");
//             });

//     } catch (e) {
//       req.flash("error", e.message);
//       return res.redirect("/add/teacherData");
//     }
//   })
// );

app.post(
  "/add/teacherData",
  verifySession, isAdminVerified,
  upload.single("data[image]"),
  validateTeacher,
  WrapAsync(async (req, res) => {
    try {
      const { data } = req.body;

      const newTeacher = new Teacher(data);

      // ✅ IMAGE OPTIONAL
      if (req.file) {
        newTeacher.image = {
          url: req.file.path,
          filename: req.file.filename,
        };
      }

      await Teacher.register(newTeacher, data.password);

      req.flash("success", "Add Teacher successfully");

      req.session.save(() => {
        return res.redirect("/add/teacherData");
      });
    } catch (e) {
      req.flash("error", e.message);

      req.session.save(() => {
        return res.redirect("/add/teacherData");
      });
    }
  }),
);

// show teacher page

// app.get(
//   "/show/teacher",
//   verifiedAny,
//   WrapAsync(async (req, res) => {
//     let datas = await Teacher.find({});
//     res.render("admin/showTeacher.ejs", { datas });
//   }),
// );

app.get(
  "/show/teacher",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { search, page } = req.query;

    // Configurations for 40 teachers per page
    let limit = 40;
    let currentPage = parseInt(page) || 1;
    let skip = (currentPage - 1) * limit;

    // Dynamic Database Filter
    let filter = {};
    if (search) {
      filter = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };
    }

    let totalTeachers = await Teacher.countDocuments(filter);
    let datas = await Teacher.find(filter).skip(skip).limit(limit);
    let totalPages = Math.ceil(totalTeachers / limit);

    res.render("admin/showTeacher.ejs", {
      datas,
      search: search || "",
      currentPage,
      totalPages,
    });
  }),
);

app.post("/teacher/toggle-status/:id", verifySession , isAdminVerified, WrapAsync( async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Direct ID validation (Mongo CastError se bachne ke liye)
    const teacher = await Teacher.findById(id);

    if (!teacher) {
      req.flash("error", "Teacher record not found!");
      return res.redirect("/show/teacher");
    }

    // 2. Safe Toggle Logic (Handles undefined / null status gracefully)
    teacher.status = teacher.status === "Blocked" ? "Active" : "Blocked";
    await teacher.save();

    req.flash("success", `Teacher (${teacher.name}) status updated to ${teacher.status}!`);
    return res.redirect("/show/teacher");

  } catch (err) {
    console.error("Error toggling teacher status:", err);
    req.flash("error", "Something went wrong while updating teacher status.");
    return res.redirect("/show/teacher");
  }
}));


//  show teacher profile

app.get(
  "/teacher/profile/:id",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let data = await Teacher.findById(id);
    res.render("admin/teacherProfile.ejs", { data });
  }),
);

// /show page /assign/teacher/class/subject/section/semester

app.get(
  "/show/teacher/class/:id",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    // req.session.teacherId = id;
    let datas = await Teacher.findById(id);
    res.render("admin/showTeacherClass.ejs", { datas });
  }),
);

// /delete/teacher/class/ /subject/secrtion/semester

// app.delete(
//   "/delete/teacher/class/:classId/semester/:semesterId/section/:sectionId",
//   verifiedAny,
//   WrapAsync(async (req, res) => {
//     const { classId, semesterId, sectionId } = req.params;
//     const teacherId = req.session.teacherId;
//     // 1️⃣ SECTION DELETE
//     await Teacher.findOneAndUpdate(
//       { _id: teacherId },
//       {
//         $pull: {
//           "class.$[cls].semesters.$[sem].sections": { _id: sectionId },
//         },
//       },
//       {
//         arrayFilters: [{ "cls._id": classId }, { "sem._id": semesterId }],
//       },
//     );

//     // 2️⃣ SEMESTER DELETE (agar sections empty ho gaye)
//     await Teacher.findOneAndUpdate(
//       { _id: teacherId },
//       {
//         $pull: {
//           "class.$[cls].semesters": {
//             _id: semesterId,
//             sections: { $size: 0 },
//           },
//         },
//       },
//       {
//         arrayFilters: [{ "cls._id": classId }],
//       },
//     );

//     // 3️⃣ CLASS DELETE (agar semesters empty ho gaye)
//     await Teacher.findOneAndUpdate(
//       { _id: teacherId },
//       {
//         $pull: {
//           class: {
//             _id: classId,
//             semesters: { $size: 0 },
//           },
//         },
//       },
//     );

//     req.flash("success", "Deleted successfully");
//     res.redirect(`/show/teacher/class/${teacherId}`);
//   }),
// );

// edit teacher

app.get(
  "/edit/teacher/:id",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let data = await Teacher.findById(id);
    res.render("admin/editTeacher.ejs", { id, data });
  }),
);

// app.put(
//   "/edit/teacher/:id",
//   verifiedAny,
//   upload.single("data[image]"),
//   validateTeacherEdit,
//   WrapAsync(async (req, res) => {
//     let { id } = req.params;
//     let { name, email, username, mobile, password } = req.body.data;
//     console.log(password);

//     let teacher = await Teacher.findById(id);

//     if (!teacher) {
//       req.flash("error", "Teacher not found");
//       return res.redirect("/show/teacher");
//     }

//     // Normal fields update
//     teacher.name = name;
//     teacher.email = email;
//     teacher.username = username;
//     teacher.mobile = mobile;

//     // Agar password change karna hai
//     if (password && password.trim() !== "") {
//       // Passport-Local-Mongoose setPassword method
//       await teacher.setPassword(password.trim());

//       // 🔴 Password change hote hi timestamp update hoga
//       teacher.passwordChangedAt = new Date();
//     }
//     if (typeof req.file !== "undefined") {
//       let url = req.file.path;
//       let filename = req.file.filename;
//       teacher.image = { url, filename };
//     }

//     await teacher.save();

//     req.flash("success", "Edit teacher successfully");
//     res.redirect("/show/teacher");
//   }),
// );

// app.put(
//   "/edit/teacher/:id",
//   verifySession, isAdminVerified,
//   upload.single("data[image]"),
//   validateTeacherEdit,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;
//     const { name, email, username, mobile, password } = req.body.data || {};

//     let teacher = await Teacher.findById(id);

//     if (!teacher) {
//       req.flash("error", "Teacher record not found.");
//       return res.redirect("/show/teacher");
//     }

//     // Normal fields update (Trimmed for cleanliness)
//     if (name) teacher.name = name.trim();
//     if (email) teacher.email = email.trim().toLowerCase();
//     if (username) teacher.username = username.trim();
//     if (mobile) teacher.mobile = mobile.trim();

//     // 🔴 1. PASSWORD & TIMESTAMP UPDATE LOGIC
//     if (password && password.trim() !== "") {
//       try {
//         // Passport-Local-Mongoose setPassword method
//         await teacher.setPassword(password.trim());

//         // 🔴 Explicitly passwordChangedAt timestamp update karna
//         teacher.passwordChangedAt = new Date();
//       } catch (passErr) {
//         console.error("SetPassword Error:", passErr);
//         req.flash("error", "Failed to update password. Please try again.");
//         return res.redirect(`/edit/teacher/${id}`);
//       }
//     }

//     // 🔴 2. SAFE IMAGE HANDLING
//     if (req.file) {
//       teacher.image = {
//         url: req.file.path,
//         filename: req.file.filename,
//       };
//     }

//     // 🔴 3. SAVE WITH DUPLICATE KEY ERROR CATCHING
//     try {
//       await teacher.save();
//     } catch (saveErr) {
//       // Catch MongoDB Unique Constraint Errors (Duplicate Username/Email/Mobile)
//       if (saveErr.code === 11000) {
//         const field = Object.keys(saveErr.keyValue || {})[0] || "field";
//         req.flash(
//           "error",
//           `Update failed! A teacher with this ${field} already exists.`,
//         );
//         return res.redirect(`/edit/teacher/${id}`);
//       }
//       throw saveErr; // Re-throw for general WrapAsync handler
//     }

//     req.flash("success", "Teacher updated successfully!");
//     return res.redirect(`/teacher/profile/${id}`);
//   }),
// );

// // DELETE TEACHER

// app.delete(
//   "/delete/teacher/:id",
//    verifySession, isAdminVerified,
//   WrapAsync(async (req, res) => {
//     let { id } = req.params;
//     let teacher = await Teacher.findByIdAndDelete(id);
//     req.flash("success", "Teacher deleted successfully");
//     res.redirect("/show/teacher");
//   }),
// );

const { syncTeacherUpdate, syncTeacherDelete } = require("./utils/syncTeacher"); // Apne correct relative path ke hisab se require karein

// ==========================================
// 1. EDIT TEACHER ROUTE (WITH TRANSACTION & SYNC)
// ==========================================
app.put(
  "/edit/teacher/:id",
  verifySession,
  isAdminVerified,
  upload.single("data[image]"),
  validateTeacherEdit,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    const { name, email, username, mobile, password } = req.body.data || {};

    let teacher = await Teacher.findById(id);

    if (!teacher) {
      req.flash("error", "Teacher record not found.");
      return res.redirect("/show/teacher");
    }

    // Dynamic Mongoose Transaction Session Initialization
    let session = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (sessionErr) {
      console.warn("⚠️ MongoDB Standalone Mode: Proceeding without transaction session.");
      session = null;
    }

    const queryOptions = session ? { session } : {};

    try {
      // Normal fields update
      if (name) teacher.name = name.trim();
      if (email) teacher.email = email.trim().toLowerCase();
      if (username) teacher.username = username.trim();
      if (mobile) teacher.mobile = mobile.trim();

      // Password Update Logic
      if (password && password.trim() !== "") {
        await teacher.setPassword(password.trim());
        teacher.passwordChangedAt = new Date();
      }

      // Safe Image Handling
      if (req.file) {
        teacher.image = {
          url: req.file.path,
          filename: req.file.filename,
        };
      }

      // Save updated Teacher Document
      await teacher.save(queryOptions);

      // 🔄 SYNC TEACHER NAME CHANGES ACROSS TIMETABLE, MARKS & ATTENDANCE
      if (name) {
        await syncTeacherUpdate(id, { name: teacher.name }, session);
      }

      // Commit Transaction if active
      if (session) {
        await session.commitTransaction();
        session.endSession();
      }

      req.flash("success", "Teacher updated successfully!");
      return res.redirect(`/teacher/profile/${id}`);

    } catch (err) {
      // Rollback database changes on error
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }

      // Catch MongoDB Unique Constraint Errors (Duplicate Username/Email/Mobile)
      if (err.code === 11000) {
        const field = Object.keys(err.keyValue || {})[0] || "field";
        req.flash(
          "error",
          `Update failed! A teacher with this ${field} already exists.`
        );
        return res.redirect(`/edit/teacher/${id}`);
      }

      throw err; // Forward general error to WrapAsync
    }
  })
);


// ==========================================
// 2. DELETE TEACHER ROUTE (WITH TRANSACTION & SYNC)
// ==========================================
app.delete(
  "/delete/teacher/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { id } = req.params;

    const teacher = await Teacher.findById(id);

    if (!teacher) {
      req.flash("error", "Teacher record not found.");
      return res.redirect("/show/teacher");
    }

    // Dynamic Mongoose Transaction Session Initialization
    let session = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (sessionErr) {
      console.warn("⚠️ MongoDB Standalone Mode: Proceeding without transaction session.");
      session = null;
    }

    const queryOptions = session ? { session } : {};

    try {
      // 🔄 1. Sync Cleanup in TimeTable & Marks
      await syncTeacherDelete(id, session);

      // 🗑️ 2. Delete Teacher Document
      await Teacher.findByIdAndDelete(id, queryOptions);

      // Commit Transaction if active
      if (session) {
        await session.commitTransaction();
        session.endSession();
      }

      req.flash("success", "Teacher deleted successfully");
      return res.redirect("/show/teacher");

    } catch (err) {
      // Rollback database changes on error
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      console.error("❌ Error deleting teacher:", err);
      req.flash("error", "Failed to delete teacher. Please try again.");
      return res.redirect("/show/teacher");
    }
  })
);

// student/

// add/StudentData

app.get(
  "/add/studentData",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let classData = await Class.find({});
    let sectionData = await Section.find({});
    res.render("admin/createStudent.ejs", { classData, sectionData });
  }),
);

app.post(
  "/add/studentData",
  verifySession, isAdminVerified,
  upload.single("data[image]"),
  validateStudent,
  WrapAsync(async (req, res) => {
    let { data } = req.body;

    if (!data.password || data.password.trim() === "") {
      data.password = String(data.rollNo);
    }

    let newStudent = new Student(data);

    // ✅ IMAGE OPTIONAL
    if (req.file) {
      newStudent.image = {
        url: req.file.path,
        filename: req.file.filename,
      };
    }

    await newStudent.save();

    req.flash("success", "Add Student successfully");
    return res.redirect("/add/studentData");
  }),
);

//  show student  page

// app.get(
//   "/show/student",
//   verifiedAny,
//   WrapAsync(async (req, res) => {
//     let datas = await Student.find({});
//     let course = await Class.find({});
//     res.render("admin/showStudent.ejs", { datas, course });
//   }),
// );

app.get(
  "/show/student",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const limit = 40;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    // Jab normal load hoga to ye empty ("") rahenge, jab search submit hoga to inme value aa jayegi
    const searchName = req.query.name ? req.query.name.trim() : "";
    const searchClass = req.query.class ? req.query.class.trim() : "";

    let filterCondition = {};

    if (searchName) {
      filterCondition.name = { $regex: searchName, $options: "i" };
    }
    if (searchClass) {
      filterCondition.class = searchClass;
    }

    // Agar filters khali hain, to countDocuments({}) sabhi ka count nikalega (Normal view)
    // Agar filters me data hai, to sirf searched data ka count nikalega (Search view)
    const totalRecords = await Student.countDocuments(filterCondition);
    const totalPages = Math.ceil(totalRecords / limit);

    let datas = await Student.find(filterCondition).skip(skip).limit(limit);

    let course = await Class.find({});

    res.render("admin/showStudent.ejs", {
      datas,
      course,
      currentPage: page,
      totalPages,
      searchName,
      searchClass,
    });
  }),
);

app.post("/student/toggle-status/:id", verifySession , isAdminVerified, WrapAsync( async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Direct ID validation (Mongo CastError se bachne ke liye)
    const student = await Student.findById(id);

    if (!student) {
      req.flash("error", "Student record not found!");
      return res.redirect("/show/student");
    }

    // 2. Safe Toggle Logic (Handles undefined / null status gracefully)
    student.status = student.status === "Blocked" ? "Active" : "Blocked";
    await student.save();

    req.flash("success", `Student (${student.name}) status updated to ${student.status}!`);
    return res.redirect("/show/student");

  } catch (err) {
    console.error("Error toggling student status:", err);
    req.flash("error", "Something went wrong while updating student status.");
    return res.redirect("/show/student");
  }
}));

// student profile

app.get(
  "/student/profile/:id",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let student = await Student.findById(id);
    res.render("admin/studentProfile.ejs", { student });
  }),
);

// edit student

app.get(
  "/edit/student/:id",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let data = await Student.findById(id);
    let classData = await Class.find({});
    let sectionData = await Section.find({});
    res.render("admin/editStudent.ejs", { id, data, classData, sectionData });
  }),
);

// app.put(
//   "/edit/student/:id",
//   verifiedAny,
//   upload.single("data[image]"),
//   validateStudent,
//   WrapAsync(async (req, res) => {
//     let { id } = req.params;
//     let student = await Student.findByIdAndUpdate(id, { ...req.body.data });

//     if (typeof req.file !== "undefined") {
//       let url = req.file.path;
//       let filename = req.file.filename;
//       student.image = { url, filename };
//     }

//     await student.save();
//      req.flash("success", "Student details updated successfully!");
//     return res.redirect(`/student/profile/${id}`);
//   }),
// );

// app.put(
//   "/edit/student/:id",
//   verifiedAny,
//   upload.single("data[image]"),
//   validateStudent,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;
//     let { data } = req.body;

//     // 1. Fetch Existing Student from DB
//     let student = await Student.findById(id);

//     if (!student) {
//       req.flash("error", "Student record not found!");
//       return res.redirect("/student/list");
//     }

//     // 🔴 BUG FIX 1: IMAGE OVERWRITE PROTECTION
//     // req.body.data me se image key remove karo taaki Object.assign purani image ko corrupt na kare
//     delete data.image;

//   if (typeof req.file !== "undefined") {
//       let url = req.file.path;
//       let filename = req.file.filename;
//       student.image = { url, filename };
//     }

//     // 🔴 BUG FIX 2: SAFE PASSWORD HANDLING
//     if (data.password && data.password.trim() !== "") {
//       student.password = data.password.trim();
//     }
//     // Form se aaye hue empty/null password string ko delete karo taaki purana password overwrite na ho
//     delete data.password;

//     // // 🔴 BUG FIX 3: SAFE EMAIL HANDLING
//     // if (!data.email || data.email.trim() === "") {
//     //   data.email = `${data.rollNo || student.rollNo}@acet.edu.in`;
//     // }

//     // 4. Update other fields (rollNo, name, fatherName, section, class, etc.)
//     Object.assign(student, data);

//     await student.save();

//     req.flash("success", "Student details updated successfully!");
//     return res.redirect(`/student/profile/${id}`);
//   })
// );

// app.put(
//   "/edit/student/:id",
//    verifySession, isAdminVerified,
//   upload.single("data[image]"),
//   validateStudent,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;
//     let { data } = req.body || {};

//     // 1. Fetch Existing Student from DB
//     let student = await Student.findById(id);

//     if (!student) {
//       req.flash("error", "Student record not found!");
//       return res.redirect("/student/list");
//     }

//     // 🔴 1. IMAGE OVERWRITE PROTECTION
//     delete data.image; // Raw image object delete kiya taaki Object.assign image corrupt na kare

//     if (req.file) {
//       student.image = {
//         url: req.file.path,
//         filename: req.file.filename,
//       };
//     }

//     // 🔴 2. SAFE PASSWORD HANDLING
//     if (data.password && data.password.trim() !== "") {
//       student.password = data.password.trim();
//     }
//     // Empty/null password string delete kiya taaki old hashed password safe rahe
//     delete data.password;

//     Object.assign(student, data);

//     try {
//       await student.save();
//     } catch (saveErr) {
//       if (
//         saveErr.code === 11000 &&
//         saveErr.keyValue &&
//         saveErr.keyValue.rollNo !== undefined
//       ) {
//         req.flash(
//           "error",
//           `Update failed! Admin Number (${saveErr.keyValue.rollNo}) is already assigned to another student.`,
//         );
//         return res.redirect(`/edit/student/${id}`);
//       }

//       throw saveErr;
//     }

//     req.flash("success", "Student details updated successfully!");
//     return res.redirect(`/student/profile/${id}`);
//   }),
// );


 
app.put(
  "/edit/student/:id",
  verifySession,
  isAdminVerified,
  upload.single("data[image]"),
  validateStudent,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    let { data } = req.body || {};

    // 1. Fetch Existing Student from DB
    let student = await Student.findById(id);

    if (!student) {
      req.flash("error", "Student record not found!");
      return res.redirect("/show/student");
    }

    // 🔴 1. IMAGE OVERWRITE PROTECTION
    delete data.image; // Raw image object delete kiya taaki Object.assign image corrupt na kare

    if (req.file) {
      student.image = {
        url: req.file.path,
        filename: req.file.filename,
      };
    }

    // 🔴 2. SAFE PASSWORD HANDLING
    if (data.password && data.password.trim() !== "") {
      student.password = data.password.trim();
    }
    delete data.password;

    Object.assign(student, data);

    // 🔴 3. TRANSACTIONAL SAVE & SYNC
    let session = null;
    let isTransactionActive = false;

    try {
      session = await mongoose.startSession();
      session.startTransaction();
      isTransactionActive = true;
    } catch (sessionErr) {
      console.warn("⚠️ Standalone MongoDB detected. Running without transaction session.");
      session = null;
      isTransactionActive = false;
    }

    const saveOptions = session ? { session } : {};

    try {
      // Save updated student in session/db
      await student.save(saveOptions);

      // Sync across Marks, Fee, and Transaction collections
      await syncStudentDetails(student, session);

      if (isTransactionActive && session) {
        await session.commitTransaction();
        session.endSession();
      }
    } catch (saveErr) {
      if (isTransactionActive && session) {
        await session.abortTransaction();
        session.endSession();
      }

      // Rollback error check for Duplicate Roll Number
      if (
        saveErr.code === 11000 &&
        saveErr.keyValue &&
        saveErr.keyValue.rollNo !== undefined
      ) {
        req.flash(
          "error",
          `Update failed! Admin Number  (${saveErr.keyValue.rollNo}) is already assigned to another student.`
        );
        return res.redirect(`/edit/student/${id}`);
      }

      throw saveErr;
    }

    req.flash("success", "Student details updated successfully!");
    return res.redirect(`/student/profile/${id}`);
  })
);


// DELETE student

app.delete(
  "/delete/student/:id",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let student = await Student.findByIdAndDelete(id);
    req.flash("success", "Student deleted successfully");
    res.redirect("/show/student");
  }),
);

// show student subject

app.get(
  "/show/student/subject/:rollNo",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { rollNo } = req.params;

    if (!rollNo) {
      req.flash("error", "Something went wrong");
      return res.redirect("/add/studentData");
    }

    // 🔹 Student sirf info ke liye
    const datas = await Student.findOne({ rollNo: parseInt(rollNo) });

    if (!datas) {
      req.flash("error", "Student not found");
      return res.redirect("/add/studentData");
    }

    return res.render("admin/showStudentSubject.ejs", { datas });
  }),
);

// delete student subject/

app.delete(
  "/delete/:studentId/subject/:subjectId",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { studentId, subjectId } = req.params;

    let data = await Student.findByIdAndUpdate(studentId, {
      $pull: { subject: { _id: subjectId } },
    });

    req.flash("success", "Subject removed successfully!");
    res.redirect(`/show/student/subject/${data.rollNo}`);
  }),
);

//  show student status

function parseIndianDate(dateStr) {
  // expected: YYYY-MM-DD (HTML input)
  const [year, month, day] = dateStr.split("-");
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 1. Base Route: Sirf Page Render Karne Ke Liye
app.get(
  "/student/status/:rollNo",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { rollNo } = req.params;

    if (!rollNo) {
      req.flash("error", "Something went wrong");
      return res.redirect("/add/studentData");
    }

    const student = await Student.findOne({ rollNo: parseInt(rollNo) });

    if (!student) {
      req.flash("error", "Student not found");
      return res.redirect("/add/studentData");
    }

    // Session mein studentId save kar rahe hain taaki API route use kar sake
    req.session.studentId = student._id;

    return res.render("admin/studentStatus.ejs", { student });
  }),
);

app.get(
  "/attendance/:studentId/api",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { studentId } = req.params;
    let { filter, from, to, academicYear, page } = req.query;

    let mainQuery = { studentId };

    // 1️⃣ Academic Year Filter Handling
    if (academicYear) {
      mainQuery.class = {
        $regex: `${academicYear}(st|nd|rd|th)?\\s+year`,
        $options: "i",
      };
    }

    // 2️⃣ Dynamic Date Calculations Pipeline
    const now = new Date();
    let isFilterActive = false;

    if (filter === "today") {
      isFilterActive = true;
      const start = new Date(now.setHours(0, 0, 0, 0));
      const end = new Date(now.setHours(23, 59, 59, 999));
      mainQuery.date = { $gte: start, $lte: end };
    } else if (filter === "weekly") {
      isFilterActive = true;
      const currentDay = now.getDay();
      const startOfWeek = new Date(now.setDate(now.getDate() - currentDay));
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(now.setDate(startOfWeek.getDate() + 6));
      endOfWeek.setHours(23, 59, 59, 999);
      mainQuery.date = { $gte: startOfWeek, $lte: endOfWeek };
    } else if (filter === "monthly") {
      isFilterActive = true;
      const startOfMonth = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );
      const endOfMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
      mainQuery.date = { $gte: startOfMonth, $lte: endOfMonth };
    } else if (filter === "custom" && from && to) {
      isFilterActive = true;
      const fromDate = parseIndianDate(from);
      fromDate.setHours(0, 0, 0, 0);

      const toDate = parseIndianDate(to);
      toDate.setHours(23, 59, 59, 999);

      mainQuery.date = { $gte: fromDate, $lte: toDate };
    }

    if (academicYear) {
      isFilterActive = true;
    }

    // 3️⃣ Global Summary Aggregation Engine (Hamesha full filtered metrics calculate karega)
    const allMatchingLogs =
      await Attendance.find(mainQuery).select("date status");

    const dayMap = new Map();
    let presentPeriodsCount = 0;
    let totalPeriodsCount = allMatchingLogs.length;

    allMatchingLogs.forEach((a) => {
      const day = new Date(a.date).toISOString().split("T")[0];
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day).push(a.status);
      if (a.status === "Present") presentPeriodsCount++;
    });

    let totalDays = dayMap.size;
    let presentDays = 0;
    dayMap.forEach((statuses) => {
      if (statuses.includes("Present")) presentDays++;
    });
    let absentDays = totalDays - presentDays;

    const globalSummary = {
      totalDays,
      presentDays,
      absentDays,
      slotsTotal: totalPeriodsCount,
      slotsPresent: presentPeriodsCount,
    };

    // 4️⃣ Paginated Table Data Logic (Ab Filter mode mein bhi pagination chalega!)
    const perPage = 100;
    const currentPage = parseInt(page) || 1;
    const totalRecords = totalPeriodsCount;
    const totalPages = Math.ceil(totalRecords / perPage) || 1;

    const skipEntries = (currentPage - 1) * perPage;

    // Table ke liye sirf current page ka data fetch karein
    const attendanceData = await Attendance.find(mainQuery)
      .sort({ date: 1, period: 1 })
      .skip(skipEntries)
      .limit(perPage);

    return res.json({
      success: true,
      data: attendanceData,
      summary: globalSummary,
      pagination: {
        totalRecords,
        totalPages,
        currentPage,
        perPage,
        isFilterActive,
      },
    });
  }),
);

// 3. Status Update Route: Dropdown se Present/Absent badalne ke liye

app.patch(
  "/attendance/update-status/:logId",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { logId } = req.params;
    const { status } = req.body;

    if (!["Present", "Absent"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status value" });
    }

    const updatedLog = await Attendance.findByIdAndUpdate(
      logId,
      { status },
      { new: true },
    );

    if (!updatedLog) {
      return res
        .status(404)
        .json({ success: false, message: "Log entry not found" });
    }

    return res.json({ success: true, message: "Status updated!", updatedLog });
  }),
);

// subjects

// add subjectData

app.get(
  "/add/subjectData",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let classData = await Class.find({});
    res.render("admin/createSubject.ejs", { classData });
  }),
);

app.post(
  "/add/subjectData",
  verifySession, isAdminVerified,
  validateSubject,
  WrapAsync(async (req, res, next) => {
    try {
      let newSubject = new Subject(req.body.data);
      await newSubject.save();

      req.flash("success", "Add subject successfully");
      res.redirect("/add/subjectData");
    } catch (error) {
      // Check agar ye MongoDB ka duplicate key error (11000) hai
      if (error.code === 11000) {
        req.flash(
          "error",
          `Subject Code "${req.body.data.code}" already exists! Please use a unique code.`,
        );
        return res.redirect("/add/subjectData");
      }

      // Agar koi aur error hai toh error-handler middleware ko pass kar do
      next(error);
    }
  }),
);

// show subject page

app.get(
  "/show/subject",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let datas = await Subject.find({});
    res.render("admin/showSubject.ejs", { datas });
  }),
);

// edit subject page//

app.get(
  "/edit/subject/:subjectId",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let subjectId = req.params.subjectId;
    let data = await Subject.findById(subjectId);
    let classData = await Class.find({});
    res.render("admin/editSubject", { data, classData });
  }),
);




const { syncSubjectUpdate, syncSubjectDelete } = require("./utils/synSubject.js");

// EDIT SUBJECT ROUTE
app.put(
  "/edit/subject/:subjectId",
  verifySession,
  isAdminVerified,
  validateSubject,
  WrapAsync(async (req, res) => {
    const { subjectId } = req.params;
    const updateData = req.body.data;

    let session = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (e) {
      session = null; // Standalone Mongo Fallback
    }

    const queryOptions = session ? { session } : {};

    try {
      // 1. Update Subject Master Record
      const updatedSubject = await Subject.findByIdAndUpdate(
        subjectId,
        { $set: updateData },
        { new: true, runValidators: true, ...queryOptions }
      );

      if (!updatedSubject) {
        if (session) {
          await session.abortTransaction();
          session.endSession();
        }
        req.flash("error", "Subject not found");
        return res.redirect("/show/subject");
      }

      // 2. Cascade Sync across Student and Teacher collections using subjectId
      // (External session pass hone par helper transaction commit/end nahi karega)
      await syncSubjectUpdate(subjectId, updateData, session);

      // 3. Commit Transaction centrally in Route
      if (session) {
        await session.commitTransaction();
        session.endSession();
      }

      req.flash("success", "Subject edited and synced successfully");
      res.redirect("/show/subject");
    } catch (err) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      throw err;
    }
  })
);

// DELETE SUBJECT ROUTE
app.delete(
  "/delete/subject/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { id } = req.params;

    let session = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (e) {
      session = null; // Standalone Mongo Fallback
    }

    const queryOptions = session ? { session } : {};

    try {
      // 1. Delete Master Subject
      const deletedSubject = await Subject.findByIdAndDelete(id, queryOptions);

      if (!deletedSubject) {
        if (session) {
          await session.abortTransaction();
          session.endSession();
        }
        req.flash("error", "Subject not found");
        return res.redirect("/show/subject");
      }

      // 2. Cascade Delete across Student and Teacher collections using subjectId
      await syncSubjectDelete(id, session);

      // 3. Commit Transaction centrally in Route
      if (session) {
        await session.commitTransaction();
        session.endSession();
      }

      req.flash("success", "Subject deleted and cleaned up successfully");
      res.redirect("/show/subject");
    } catch (err) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      throw err;
    }
  })
);

// app.put(
//   "/edit/subject/:subjectId",
//    verifySession, isAdminVerified,
//   validateSubject,
//   WrapAsync(async (req, res) => {
//     let subjectId = req.params.subjectId;
//     let subject = await Subject.findByIdAndUpdate(subjectId, {
//       ...req.body.data,
//     });
//     await subject.save();
//     req.flash("success", "Subject edit successfully");
//     res.redirect("/show/subject");
//   }),
// );

// // delete subject

// app.delete(
//   "/delete/subject/:id",
//   verifySession, isAdminVerified,
//   WrapAsync(async (req, res) => {
//     let { id } = req.params;
//     let subject = await Subject.findByIdAndDelete(id);
//     req.flash("success", "Subject deleted successfully");
//     res.redirect("/show/subject");
//   }),
// );

// search page for subject

// app.post(
//   "/search/subject",
//   verifiedAny,
//   WrapAsync(async (req, res) => {
//     let { search } = req.body;
//     let datas = await Subject.find({
//       name: { $regex: search, $options: "i" },
//     });
//     if (datas.length === 0) {
//       req.flash("error", "Subject not found!");
//       res.redirect("/show/subject");
//     } else {
//       res.render("admin/searchSubject.ejs", { datas });
//     }
//   }),
// );

// classes//

// add/class

app.get("/add/class", verifySession, isAdminVerified, (req, res) => {
  res.render("admin/createClass.ejs");
});

app.post(
  "/add/class",
  verifySession, isAdminVerified,
  validateClass,
  WrapAsync(async (req, res) => {
    let { class: className } = req.body.data;

    // Auto format (uppercase + trim + single space)
    className = className.toUpperCase().trim().replace(/\s+/g, " ");

    // ✅ Allowed formats (B.TECH only — no BTECH)
    const classFormat =
      /^(B\.TECH(\s(CSE|IT|ECE|EEE|EE|ME|CIVIL|AI\/ML|DS))?|BCA|BBA|B\.SC|M\.SC|MCA|MBA|DIPLOMA(\s(CIVIL|ME|EE|CSE))?|BA|MA|ITI|POLYTECHNIC)\s(1ST|2ND|3RD|4TH)\sYEAR$/;

    // ❌ Reject if BTECH without dot typed
    if (/^BTECH/.test(className)) {
      req.flash("error", "Use proper format: B.TECH (not BTECH)");
      return res.redirect("/add/class");
    }

    // ❌ Invalid format check
    if (!classFormat.test(className)) {
      req.flash(
        "error",
        "Invalid format! Examples:\n• B.TECH CSE 1ST YEAR\n• BCA 2ND YEAR\n• BA 1ST YEAR",
      );
      return res.redirect("/add/class");
    }

    // ✅ Duplicate check before save
    const exists = await Class.findOne({ class: className });
    if (exists) {
      req.flash("error", "This class already exists!");
      return res.redirect("/add/class");
    }

    // Save formatted class
    req.body.data.class = className;
    await new Class(req.body.data).save();

    req.flash("success", "Class added successfully");
    res.redirect("/add/class");
  }),
);

// show class page

app.get(
  "/show/class",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let datas = await Class.find({});
    res.render("admin/showClass.ejs", { datas });
  }),
);

app.delete(
  "/delete/class/:id",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let data = await Class.findByIdAndDelete(id);
    req.flash("success", "  Class deleted successfully");
    res.redirect("/show/class");
  }),
);

// add Section /

app.get("/add/section", verifySession, isAdminVerified, (req, res) => {
  res.render("admin/createSection.ejs");
});
app.post(
  "/add/section",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { name } = req.body.data;

    // basic validation
    if (!name || name.length !== 1) {
      req.flash("error", "Section must be a single character (A, B, C)");
      return res.redirect("/add/section");
    }

    // uppercase (a → A)
    name = name.toUpperCase();

    // 🔥 DUPLICATE CHECK
    let existingSection = await Section.findOne({ name });

    if (existingSection) {
      req.flash("error", `Section "${name}" already exists`);
      return res.redirect("/add/section");
    }

    let data = new Section({ name });
    await data.save();

    req.flash("success", "Section added successfully");
    res.redirect("/add/section");
  }),
);

// show section
app.get(
  "/show/section",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let datas = await Section.find({});
    res.render("admin/showSection.ejs", { datas });
  }),
);

// delete section

app.delete(
  "/delete/section/:id",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    await Section.findByIdAndDelete(req.params.id);
    req.flash("success", "  Section deleted successfully");
    res.redirect("/show/section");
  }),
);

//----------------------------------------- Teacher Assigning ----------------------------------------------------------------

// ajax find teacher subject option?

app.get(
  "/get-subjects/:className/:semester",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className, semester } = req.params;

    const subjects = await Subject.find({
      course: className,
      semester: semester,
    });

    res.json(subjects);
  }),
);

//<!-------------------------------------------------  TIME TABLE --------------------------------------------->

// assign/teacher/subject/class   AND timeTABLE page

app.get(
  "/assign/teacher/subject/class",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let teacherData = await Teacher.find({});
    let classData = await Class.find({});
    let subjectData = await Subject.find({});
    let sectionData = await Section.find({});

    res.render("admin/teacherAssign.ejs", {
      teacherData,
      classData,
      subjectData,
      sectionData,
    });
  }),
);

//  Auto Matic  TIME TABLE  KE  PERIOD KA TIME FETCH KARNE KE LIYE

app.get(
  "/api/timetable/check-timings",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className, semester, section } = req.query;
    if (!className || !semester || !section) {
      return res.json({ success: false, lockedTimings: {} });
    }

    // Is specific batch ka pehle se save koi bhi data nikal lo
    const existingSlots = await TimeTable.find({
      className,
      semester,
      section,
    });

    const lockedTimings = {};
    existingSlots.forEach((slot) => {
      lockedTimings[slot.lecture_number] = {
        start_time: slot.start_time,
        end_time: slot.end_time,
      };
    });

    res.json({ success: true, lockedTimings });
  }),
);

// Helper Function: Convert 24hr format "18:21" to 12hr AM/PM format "06:21 PM"

function convertTo12HourFormat(time24) {
  if (!time24) return "";
  let [hours, minutes] = time24.split(":");
  hours = parseInt(hours);
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12; // '0' value hours standardizes to '12'
  hours = hours < 10 ? "0" + hours : hours;
  return `${hours}:${minutes} ${ampm}`;
}

// Helper Function: Convert time to minutes (Handles both 12-hour and 24-hour inputs)
function timeToMinutes(timeString) {
  if (!timeString) return 0;

  const parts = timeString.trim().split(" ");
  const time = parts[0];
  const modifier = parts[1] ? parts[1].toUpperCase() : null;

  let [hours, minutes] = time.split(":").map(Number);

  if (modifier) {
    if (modifier === "PM" && hours < 12) hours += 12;
    if (modifier === "AM" && hours === 12) hours = 0;
  }

  return hours * 60 + minutes;
}

// Helper Function: Convert time to minutes for operational overlap validations
// function timeToMinutes(timeString) {
//   const [time, modifier] = timeString.split(" ");
//   let [hours, minutes] = time.split(":").map(Number);
//   if (modifier === "PM" && hours < 12) hours += 12;
//   if (modifier === "AM" && hours === 12) hours = 0;
//   return hours * 60 + minutes;
// }

app.post(
  "/assign/teacher/subject/bulk-day",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const session = await Teacher.startSession();
    try {
      const baseData = req.body.baseData || {};
      const slotsObj = req.body.slots || {};
      const isEdit = req.body.isEdit === "true" || req.body.isEdit === true;
      const { className, semester, section, day_of_week } = baseData;

      let slots = Array.isArray(slotsObj) ? slotsObj : Object.values(slotsObj);

      if (
        !className ||
        !semester ||
        !section ||
        !day_of_week ||
        !slots ||
        slots.length === 0
      ) {
        req.flash(
          "error",
          "⚠️ Invalid dataset or missing mandatory class coordinates.",
        );
        return res.redirect("/assign/teacher/subject/class");
      }

      // =================================================================
      // 🔥 BLOCKER LOGIC: DIRECT SAVE SE SAFETY
      // =================================================================
      if (!isEdit) {
        const checkExisting = await TimeTable.findOne({
          className,
          semester,
          section,
          day_of_week,
        });
        if (checkExisting) {
          req.flash(
            "error",
            `⚠️ Schedule Already Exists: The schedule for ${day_of_week} has already been saved. Please click 'Edit' on the Dashboard to modify it.`,
          );
          return res.redirect("/assign/teacher/subject/class");
        }
      }

      // 🛡️ BACKEND SECURE AUTO-SYNC: Monday template fallback
      if (day_of_week !== "Mon") {
        const mondayLayout = await TimeTable.find({
          className,
          semester,
          section,
          day_of_week: "Mon",
        }).sort({ _id: 1 });

        if (!mondayLayout || mondayLayout.length === 0) {
          req.flash(
            "error",
            "⚠️ Operation Aborted: Please configure Monday's schedule first to freeze the timetable timings.",
          );
          return res.redirect("/assign/teacher/subject/class");
        }

        slots = slots.map((slot, index) => {
          const masterRow = mondayLayout[index];
          if (masterRow) {
            return {
              ...slot,
              lecture_number: masterRow.lecture_number,
              start_time: masterRow.start_time,
              end_time: masterRow.end_time,
            };
          }
          return slot;
        });
      }

      const lunchSlotsCount = slots.filter(
        (s) => s && s.lecture_number === "LUNCH",
      ).length;
      if (lunchSlotsCount === 0) {
        req.flash("error", "⚠️ Server Denied: Lunch break is compulsory.");
        return res.redirect("/assign/teacher/subject/class");
      }

      await session.withTransaction(async () => {
        // =================================================================
        // 🛑 CRITICAL STAGE 1: MONDAY TIMING CASCADE PRE-CHECK INTERCEPTOR
        // =================================================================
        if (isEdit && day_of_week === "Mon") {
          for (let slot of slots) {
            if (
              !slot ||
              slot.lecture_number === "LUNCH" ||
              !slot.username ||
              !slot.subject
            )
              continue;

            const targetNewStart = convertTo12HourFormat(slot.start_time);
            const targetNewEnd = convertTo12HourFormat(slot.end_time);
            const newStartMins = timeToMinutes(targetNewStart);
            const newEndMins = timeToMinutes(targetNewEnd);

            const cascadeTargets = await TimeTable.find({
              className,
              semester,
              section,
              lecture_number: slot.lecture_number,
              day_of_week: { $ne: "Mon" },
            }).session(session);

            for (let target of cascadeTargets) {
              if (!target.teacher_id) continue;

              const potentialClashes = await TimeTable.find({
                day_of_week: target.day_of_week,
                teacher_id: target.teacher_id,
                $or: [
                  { className: { $ne: className } },
                  { semester: { $ne: semester } },
                  { section: { $ne: section } },
                  { lecture_number: { $ne: slot.lecture_number } },
                ],
              }).session(session);

              for (let clash of potentialClashes) {
                const existingStartMins = timeToMinutes(clash.start_time);
                const existingEndMins = timeToMinutes(clash.end_time);

                if (
                  newStartMins < existingEndMins &&
                  newEndMins > existingStartMins
                ) {
                  throw new Error(
                    `⚠️ Schedule Conflict: If you change Monday's timing, ${target.day_of_week}'s timing will also change. This will create a timing conflict for ${target.teacher_name}, who is already assigned to another class [${clash.className} ${clash.section}] from ${clash.start_time} to ${clash.end_time}.`,
                  );
                }
              }
            }
          }
        }

        // =================================================================
        // 🛑 STAGE 1.5: PRE-CHECK TEMPORARY SUBJECT CONFLICT INTERCEPTOR
        // =================================================================
        for (let slot of slots) {
          if (
            !slot ||
            slot.lecture_number === "LUNCH" ||
            !slot.username ||
            !slot.subject
          )
            continue;

          // 🛠️ BUG FIX 1: CastError Safe Parsing
          const safeSlotSubjectId =
            slot.subject_id &&
            slot.subject_id.trim() !== "" &&
            mongoose.Types.ObjectId.isValid(slot.subject_id)
              ? slot.subject_id
              : null;

          const teacherObj = await Teacher.findOne({
            username: slot.username,
          }).session(session);
          if (!teacherObj) continue;

          // Check if subject exists in temporarySubjects for this class/sem/sec
          const classObj = teacherObj.class.find(
            (cls) => cls.className === className,
          );
          if (classObj) {
            const semObj = classObj.semesters.find(
              (sem) => String(sem.semester) === String(semester),
            );
            if (semObj) {
              const secObj = semObj.sections.find(
                (sec) => sec.section === section,
              );
              if (
                secObj &&
                secObj.temporarySubjects &&
                // 🛠️ BUG FIX 2: Strict Truthy Safe Comparison
                secObj.temporarySubjects.some(
                  (ts) =>
                    ts.subjectName === slot.subject ||
                    (safeSlotSubjectId &&
                      ts.subjectId &&
                      String(ts.subjectId) === String(safeSlotSubjectId)),
                )
              ) {
                throw new Error(
                  `⚠️ Cannot assign '${slot.subject}' to ${teacherObj.name}. This subject is currently assigned as a temporary subject. Please remove it from temporary assignments first.`,
                );
              }
            }
          }
        }

        // =================================================================
        // 🎯 STAGE 2: BACKUP TARGET DAY SLOTS & REWRITE TIMETABLE GRID
        // =================================================================
        let oldSlots = [];
        let historicTeachersList = [];

        if (isEdit) {
          oldSlots = await TimeTable.find({
            className,
            semester,
            section,
            day_of_week,
          }).session(session);

          historicTeachersList = [
            ...new Set(
              oldSlots
                .map((s) => (s.teacher_id ? s.teacher_id.toString() : null))
                .filter(Boolean),
            ),
          ];
        }

        await TimeTable.deleteMany({
          className,
          semester,
          section,
          day_of_week,
        }).session(session);

        for (let slot of slots) {
          if (!slot) continue;

          let {
            lecture_number,
            start_time,
            end_time,
            subject,
            subject_id,
            username,
          } = slot;

          // 🛠️ BUG FIX 1: CastError Protection for Insert
          const safeSubjectId =
            subject_id &&
            subject_id.trim() !== "" &&
            mongoose.Types.ObjectId.isValid(subject_id)
              ? subject_id
              : null;

          const isLunch = lecture_number === "LUNCH";

          const formattedStartTime =
            day_of_week === "Mon"
              ? convertTo12HourFormat(start_time)
              : start_time;
          const formattedEndTime =
            day_of_week === "Mon" ? convertTo12HourFormat(end_time) : end_time;

          if (isLunch) {
            const lunchSlot = new TimeTable({
              day_of_week,
              lecture_number: "LUNCH",
              start_time: formattedStartTime,
              end_time: formattedEndTime,
              className,
              semester,
              section,
              teacher_name: "N/A",
              subject_name: "🍔 LUNCH BREAK",
            });
            await lunchSlot.save({ session });
            continue;
          }

          if (!subject || !username) continue;

          const teacherObj = await Teacher.findOne({ username }).session(
            session,
          );
          if (!teacherObj)
            throw new Error(`Faculty matching '${username}' not found.`);

          const newStartMins = timeToMinutes(formattedStartTime);
          const newEndMins = timeToMinutes(formattedEndTime);

          const teacherAllAssignments = await TimeTable.find({
            day_of_week,
            teacher_id: teacherObj._id,
          }).session(session);

          for (let assignment of teacherAllAssignments) {
            const existingStartMins = timeToMinutes(assignment.start_time);
            const existingEndMins = timeToMinutes(assignment.end_time);

            if (
              newStartMins < existingEndMins &&
              newEndMins > existingStartMins
            ) {
              throw new Error(
                `Timing Conflict! ${teacherObj.name} is already busy in Class [${assignment.className} ${assignment.section}] from ${assignment.start_time} to ${assignment.end_time}.`,
              );
            }
          }

          const newSlot = new TimeTable({
            day_of_week,
            lecture_number,
            start_time: formattedStartTime,
            end_time: formattedEndTime,
            className,
            semester,
            section,
            teacher_id: teacherObj._id,
            teacher_name: teacherObj.name,
            subject_id: safeSubjectId,
            subject_name: subject,
          });
          await newSlot.save({ session });

          // Sync Teacher Subdocs
          let classObj = teacherObj.class.find(
            (cls) => cls.className === className,
          );
          if (!classObj) {
            classObj = { className, semesters: [] };
            teacherObj.class.push(classObj);
            classObj = teacherObj.class[teacherObj.class.length - 1];
          }

          let semesterObj = classObj.semesters.find(
            (sem) => String(sem.semester) === String(semester),
          );
          if (!semesterObj) {
            semesterObj = { semester: semester, sections: [] };
            classObj.semesters.push(semesterObj);
            semesterObj = classObj.semesters[classObj.semesters.length - 1];
          }

          let sectionObj = semesterObj.sections.find(
            (sec) => sec.section === section,
          );
          if (!sectionObj) {
            sectionObj = { section, subjects: [] };
            semesterObj.sections.push(sectionObj);
            sectionObj = semesterObj.sections[
              semesterObj.sections.length - 1
            ];
          }

          // 🛠️ BUG FIX 2: Strict Truthy Check
          const isAlreadyTemp =
            sectionObj.temporarySubjects &&
            sectionObj.temporarySubjects.some(
              (ts) =>
                ts.subjectName === subject ||
                (safeSubjectId &&
                  ts.subjectId &&
                  String(ts.subjectId) === String(safeSubjectId)),
            );

          const isAlreadyAssigned = sectionObj.subjects.some(
            (sub) =>
              sub.subjectName === subject ||
              (safeSubjectId &&
                sub.subjectId &&
                String(sub.subjectId) === String(safeSubjectId)),
          );

          if (!isAlreadyAssigned && !isAlreadyTemp) {
            sectionObj.subjects.push({
              subjectName: subject,
              subjectId: safeSubjectId,
            });
          }

          teacherObj.markModified("class");
          await teacherObj.save({ session });
        }

        // =================================================================
        // 🛡️ STAGE 3: SMART GLOBAL AUDIT FOR PROFILE SYNCHRONIZATION
        // =================================================================
        if (isEdit && historicTeachersList.length > 0) {
          const currentWeekSchedule = await TimeTable.find({
            className,
            semester,
            section,
          }).session(session);

          for (let oldTeacherId of historicTeachersList) {
            const targetTeacherDoc =
              await Teacher.findById(oldTeacherId).session(session);
            if (!targetTeacherDoc) continue;

            const stillAssignedSomewhere = currentWeekSchedule.some(
              (s) => s.teacher_id && s.teacher_id.toString() === oldTeacherId,
            );

            let classIdx = targetTeacherDoc.class.findIndex(
              (c) => c.className === className,
            );
            let semIdx =
              classIdx !== -1
                ? targetTeacherDoc.class[classIdx].semesters.findIndex(
                    (s) => String(s.semester) === String(semester),
                  )
                : -1;
            let secIdx =
              semIdx !== -1
                ? targetTeacherDoc.class[classIdx].semesters[
                    semIdx
                  ].sections.findIndex((s) => s.section === section)
                : -1;

            let existingTempSubs = [];
            if (secIdx !== -1) {
              existingTempSubs =
                targetTeacherDoc.class[classIdx].semesters[semIdx].sections[
                  secIdx
                ].temporarySubjects || [];
            }

            if (!stillAssignedSomewhere && existingTempSubs.length === 0) {
              if (classIdx !== -1 && semIdx !== -1) {
                let targetSem =
                  targetTeacherDoc.class[classIdx].semesters[semIdx];
                targetSem.sections = targetSem.sections.filter(
                  (sec) => sec.section !== section,
                );

                if (targetSem.sections.length === 0) {
                  targetTeacherDoc.class[classIdx].semesters.splice(
                    semIdx,
                    1,
                  );
                }
                if (targetTeacherDoc.class[classIdx].semesters.length === 0) {
                  targetTeacherDoc.class.splice(classIdx, 1);
                }
              }
            } else {
              const activeSubjectsInWeek = currentWeekSchedule
                .filter(
                  (s) =>
                    s.teacher_id &&
                    s.teacher_id.toString() === oldTeacherId &&
                    s.subject_name,
                )
                .map((s) => ({
                  subjectName: s.subject_name,
                  subjectId: s.subject_id || null,
                }));

              if (secIdx !== -1) {
                const secRef =
                  targetTeacherDoc.class[classIdx].semesters[semIdx].sections[
                    secIdx
                  ];
                const tempSubs = secRef.temporarySubjects || [];

                const combinedList = [...activeSubjectsInWeek, ...tempSubs];
                const uniqueSubjectsMap = new Map();

                // 🛠️ BUG FIX 3: Legacy Subject Fallback
                combinedList.forEach((item) => {
                  const mapKey = item.subjectId
                    ? String(item.subjectId)
                    : item.subjectName;
                  if (mapKey) {
                    uniqueSubjectsMap.set(mapKey, item);
                  }
                });

                secRef.subjects = Array.from(uniqueSubjectsMap.values());
              }
            }

            targetTeacherDoc.markModified("class");
            await targetTeacherDoc.save({ session });
          }
        }

        // =================================================================
        // ⏱️ STAGE 4: MONDAY CASCADE EXECUTION
        // =================================================================
        if (isEdit && day_of_week === "Mon") {
          for (let slot of slots) {
            if (!slot) continue;
            const formattedStartTime = convertTo12HourFormat(slot.start_time);
            const formattedEndTime = convertTo12HourFormat(slot.end_time);

            await TimeTable.updateMany(
              {
                className,
                semester,
                section,
                lecture_number: slot.lecture_number,
                day_of_week: { $ne: "Mon" },
              },
              {
                $set: {
                  start_time: formattedStartTime,
                  end_time: formattedEndTime,
                },
              },
              { session },
            );
          }
        }
      });

      req.flash(
        "success",
        isEdit
          ? "Timetable layout updated with Master Monday cascades successfully! 🚀"
          : "Full day grid configuration saved successfully! 🚀",
      );
      res.redirect(
        `/timetable/dashboard?className=${encodeURIComponent(className)}`,
      );
    } catch (err) {
      console.error("🔥 Timetable Interceptor Block triggered:", err.message);

      const userMessage =
        err.message.includes("Transaction") || err.message.includes("Mongo")
          ? "⚠️ System encountered a database collision. Please try submitting again."
          : err.message;

      req.flash("error", userMessage);
      res.redirect("/assign/teacher/subject/class");
    } finally {
      await session.endSession();
    }
  }),
);


app.post(
  "/timetable/delete-section",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const session = await Teacher.startSession();
    try {
      const { className, semester, section } = req.body;

      if (!className || !semester || !section) {
        req.flash(
          "error",
          "⚠️ Operation Failed: Missing core parameters to delete section.",
        );
        return res.redirect("/timetable/dashboard");
      }

      await session.withTransaction(async () => {
        // 1. Target section ke sare TimeTable slots fetch karo
        const allSectionSlots = await TimeTable.find({
          className,
          semester,
          section,
        }).session(session);

        if (allSectionSlots.length === 0) {
          throw new Error(
            "Nothing to delete. No schedule data was found for this section.",
          );
        }

        // 2. Unique Teacher IDs safely extract karo
        const uniqueTeacherIds = [
          ...new Set(
            allSectionSlots
              .map((slot) => slot.teacher_id?.toString())
              .filter(Boolean),
          ),
        ];

        // 3. Har Teacher Record par Safe Structural Operations
        for (let teacherId of uniqueTeacherIds) {
          const teacherObj = await Teacher.findById(teacherId).session(session);

          if (teacherObj && teacherObj.class) {
            let classIdx = teacherObj.class.findIndex(
              (c) => c.className === className,
            );

            if (classIdx !== -1) {
              let targetClass = teacherObj.class[classIdx];
              let semIdx = targetClass.semesters.findIndex(
                (s) => String(s.semester) === String(semester),
              );

              if (semIdx !== -1) {
                let targetSem = targetClass.semesters[semIdx];
                let secIdx = targetSem.sections.findIndex(
                  (sec) => sec.section === section,
                );

                if (secIdx !== -1) {
                  let targetSec = targetSem.sections[secIdx];
                  const tempSubs = targetSec.temporarySubjects || [];

                  if (tempSubs.length > 0) {
                    // 🛡️ Temporary Subjects Majood hain: Normal subjects wipe karo, Temp Subjects Preserve rakho
                    targetSec.subjects = [...tempSubs];
                  } else {
                    // 🗑️ Temporary Subjects NAHI hain: Section poora delete karo
                    targetSem.sections.splice(secIdx, 1);
                  }
                }

                // 🔹 Clean-Up: Agar Semester me ab 0 sections bache
                if (targetSem.sections.length === 0) {
                  targetClass.semesters.splice(semIdx, 1);
                }
              }

              // 🔹 Clean-Up: Agar Class me ab 0 semesters bache
              if (targetClass.semesters.length === 0) {
                teacherObj.class.splice(classIdx, 1);
              }
            }

            teacherObj.markModified("class");
            await teacherObj.save({ session });
          }
        }

        // 4. TimeTable Collection se slots clear karo
        await TimeTable.deleteMany({ className, semester, section }).session(
          session,
        );
      });

      req.flash(
        "success",
        `🗑️ Section Deleted: Complete timetable for [${className} - Sem ${semester} - Sec ${section}] removed. Temporary assignments were kept safe.`,
      );
      res.redirect(
        `/timetable/dashboard?className=${encodeURIComponent(className)}`,
      );
    } catch (err) {
      console.error("🔥 Bulk Section Delete Error:", err.message);
      req.flash("error", `Master Deletion Failed: ${err.message}`);
      res.redirect("/timetable/dashboard");
    } finally {
      await session.endSession();
    }
  }),
);

// 🛠️ API ROUTE: Frontend copy replicator tool ke liye data dene waala route

app.get(
  "/api/timetable/get-day-layout",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className, semester, section, day } = req.query;

    if (!className || !semester || !section || !day) {
      return res
        .status(400)
        .json({ success: false, message: "Missing query coordinates" });
    }

    const timetableData = await TimeTable.find({
      className,
      semester: Number(semester),
      section,
      day_of_week: day,
    }).populate("teacher_id");

    if (!timetableData || timetableData.length === 0) {
      return res.json({
        success: false,
        data: [],
        message: "No template found for this day",
      });
    }

    res.json({ success: true, data: timetableData });
  }),
);

// SHOW TIME TABLE

app.get(
  "/timetable/dashboard",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className } = req.query;

    // Saare unique courses nikalne ke liye (Dropdown ke liye)
    const allCourses = await TimeTable.distinct("className");

    let groupedTimetable = {};

    if (className) {
      // Agar course select kiya hai, toh us course ka saara data nikalo
      const scheduleData = await TimeTable.find({ className });

      // Data ko Semester aur Section ke hisab se group karein
      scheduleData.forEach((slot) => {
        const sem = slot.semester;
        const sec = slot.section;

        if (!groupedTimetable[sem]) {
          groupedTimetable[sem] = {};
        }
        if (!groupedTimetable[sem][sec]) {
          groupedTimetable[sem][sec] = {
            periods: [],
            timetableMap: {
              Mon: {},
              Tue: {},
              Wed: {},
              Thu: {},
              Fri: {},
              Sat: {},
            },
          };
        }

        // Timetable map fill karna
        groupedTimetable[sem][sec].timetableMap[slot.day_of_week][
          slot.lecture_number
        ] = {
          subject: slot.subject_name || "-",
          teacher: slot.teacher_name || "N/A",
        };

        // Periods array fill karna (Unique check ke sath)
        if (
          !groupedTimetable[sem][sec].periods.some(
            (p) => p.id === slot.lecture_number,
          )
        ) {
          groupedTimetable[sem][sec].periods.push({
            id: slot.lecture_number,
            timeStr: slot.start_time,
            displayTime: `${slot.start_time} - ${slot.end_time}`,
          });
        }
      });

      // Har Semester aur Section ke andar ke periods ko time ke hisab se sort karna
      const convertTimeToMinutes = (timeStr) => {
        if (!timeStr) return 0;
        let [time, modifier] = timeStr.trim().split(" ");
        let [hours, minutes] = time.split(":").map(Number);
        if (modifier) {
          const upperModifier = modifier.toUpperCase();
          if (upperModifier === "PM" && hours < 12) hours += 12;
          if (upperModifier === "AM" && hours === 12) hours = 0;
        } else if (hours >= 1 && hours <= 6) {
          hours += 12;
        }
        return hours * 60 + minutes;
      };

      Object.keys(groupedTimetable).forEach((sem) => {
        Object.keys(groupedTimetable[sem]).forEach((sec) => {
          groupedTimetable[sem][sec].periods.sort(
            (a, b) =>
              convertTimeToMinutes(a.timeStr) - convertTimeToMinutes(b.timeStr),
          );
        });
      });
    }

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayNames = {
      Mon: "Mon",
      Tue: "Tue",
      Wed: "Wed",
      Thu: "Thu",
      Fri: "Fri",
      Sat: "Sat",
    };

    res.render("admin/showTimeTable.ejs", {
      allCourses,
      selectedCourse: className || null,
      groupedTimetable,
      days,
      dayNames,
    });
  }),
);

// show teacher subject in bullllllk

app.get(
  "/admin/show-all-teachers-assignments",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const teachers = await Teacher.find({ "class.0": { $exists: true } });
    let tableRows = [];

    teachers.forEach((teacher) => {
      teacher.class.forEach((cls) => {
        cls.semesters.forEach((sem) => {
          sem.sections.forEach((sec) => {
            tableRows.push({
              teacherId: teacher._id, // Main Teacher ID
              teacherName: teacher.name,
              username: teacher.username,
              classId: cls._id, // Sub-document IDs
              className: cls.className,
              semesterId: sem._id,
              semester: sem.semester,
              sectionId: sec._id,
              section: sec.section,
              subjects: sec.subjects,
            });
          });
        });
      });
    });

    res.render("admin/showTeacherAssinging.ejs", { tableRows });
  }),
);

// Temporary   Assign class and Subject  when teacher is  Absent

app.get(
  "/temporary/assign/teacher/subject/class",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let teacherData = await Teacher.find({});
    let classData = await Class.find({});
    let subjectData = await Subject.find({});
    let sectionData = await Section.find({});

    res.render("admin/temporaryTeacherAssign.ejs", {
      teacherData,
      classData,
      subjectData,
      sectionData,
    });
  }),
);

app.post(
  "/temporary/assign/teacher/subject/class",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const session = await Teacher.startSession();

    try {
      let { className, semester, section, usernames, subjects } = req.body.data;

      // 1. Array Normalization & Unique Filter (Prevents duplicate requests)
      if (!usernames) usernames = [];
      if (!subjects) subjects = [];
      if (!Array.isArray(usernames)) usernames = [usernames];
      if (!Array.isArray(subjects)) subjects = [subjects];

      usernames = [...new Set(usernames)]; // Duplicate usernames remove kiye

      // 2. Safe JSON Parsing & Validation
      const parsedSubjects = [];
      for (let sub of subjects) {
        try {
          let parsed = typeof sub === "string" ? JSON.parse(sub) : sub;
          if (
            parsed &&
            parsed.subjectId &&
            parsed.subjectName &&
            mongoose.Types.ObjectId.isValid(parsed.subjectId)
          ) {
            parsedSubjects.push({
              subjectId: new mongoose.Types.ObjectId(parsed.subjectId),
              subjectName: parsed.subjectName.trim(),
            });
          }
        } catch (e) {
          console.error("Invalid Subject Data JSON:", sub);
        }
      }

      if (
        usernames.length === 0 ||
        parsedSubjects.length === 0 ||
        !className ||
        !semester ||
        !section
      ) {
        req.flash(
          "error",
          "All fields, valid subject options and at least one teacher must be selected!"
        );
        return res.redirect("/temporary/assign/teacher/subject/class");
      }

      // 3. Optimized Transaction
      await session.withTransaction(async () => {
        // 🔥 OPTIMIZATION 1: Ek hi query mein saare Teachers fetch kar liye
        const teachers = await Teacher.find({ username: { $in: usernames } }).session(session);
        if (teachers.length === 0) return;

        const teacherIds = teachers.map((t) => t._id);
        const subjectNames = parsedSubjects.map((s) => s.subjectName);

        // 🔥 OPTIMIZATION 2: Single query se regular timetable conflict check
        const conflictSlot = await TimeTable.findOne({
          className,
          semester,
          section,
          teacher_id: { $in: teacherIds },
          subject_name: { $in: subjectNames },
        }).session(session);

        if (conflictSlot) {
          const matchedTeacher = teachers.find(
            (t) => t._id.toString() === conflictSlot.teacher_id.toString()
          );
          throw new Error(
            `⚠️ Cannot assign temporary subject: '${conflictSlot.subject_name}' is already assigned to ${matchedTeacher ? matchedTeacher.name : 'a teacher'} via regular timetable!`
          );
        }

        // 🔥 OPTIMIZATION 3: Sequential Processing (Avoids DB Lock Delay)
        for (let teacher of teachers) {
          // Step A: Class Level
          let classObj = teacher.class.find((cls) => cls.className === className);
          if (!classObj) {
            teacher.class.push({ className, semesters: [] });
            classObj = teacher.class[teacher.class.length - 1];
          }

          // Step B: Semester Level
          let semesterObj = classObj.semesters.find(
            (sem) => sem.semester == semester
          );
          if (!semesterObj) {
            classObj.semesters.push({ semester: Number(semester), sections: [] });
            semesterObj = classObj.semesters[classObj.semesters.length - 1];
          }

          // Step C: Section Level
          let sectionObj = semesterObj.sections.find(
            (sec) => sec.section === section
          );
          if (!sectionObj) {
            semesterObj.sections.push({
              section,
              subjects: [],
              temporarySubjects: [],
            });
            sectionObj = semesterObj.sections[semesterObj.sections.length - 1];
          }

          if (!sectionObj.temporarySubjects) sectionObj.temporarySubjects = [];
          if (!sectionObj.subjects) sectionObj.subjects = [];

          // Step D: Bulk Push
          parsedSubjects.forEach((subObj) => {
            const targetIdStr = subObj.subjectId.toString();

            const existsInSubjects = sectionObj.subjects.some((s) => {
              if (typeof s === "string") return s === subObj.subjectName;
              return s?.subjectId?.toString() === targetIdStr;
            });

            if (!existsInSubjects) {
              sectionObj.subjects.push({
                subjectId: subObj.subjectId,
                subjectName: subObj.subjectName,
              });
            }

            const existsInTemp = sectionObj.temporarySubjects.some((s) => {
              if (typeof s === "string") return s === subObj.subjectName;
              return s?.subjectId?.toString() === targetIdStr;
            });

            if (!existsInTemp) {
              sectionObj.temporarySubjects.push({
                subjectId: subObj.subjectId,
                subjectName: subObj.subjectName,
              });
            }
          });

          teacher.markModified("class");
          await teacher.save({ session });
        }
      });

      req.flash(
        "success",
        `Successfully temporary assigned ${parsedSubjects.length} subjects to ${usernames.length} teachers! 🚀`
      );
      res.redirect("/temporary/assign/teacher/subject/class");
    } catch (err) {
      console.error("🔥 Bulk Assignment Failed:", err.message);

      const userMessage = err.message.startsWith("⚠️")
        ? err.message
        : "Transaction failed! No changes were saved to the database.";

      req.flash("error", userMessage);
      res.redirect("/temporary/assign/teacher/subject/class");
    } finally {
      await session.endSession();
    }
  })
);


// 🔹 1. SHOW TEMPORARY TEACHERS ASSIGNMENTS
app.get(
  "/show-temporary-teachers-assignments",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    // Fetch teachers having non-empty temporarySubjects
    const teachers = await Teacher.find({
      "class.semesters.sections.temporarySubjects.0": { $exists: true },
    }).lean();

    let tableRows = [];

    teachers.forEach((teacher) => {
      teacher.class?.forEach((cls) => {
        cls.semesters?.forEach((sem) => {
          sem.sections?.forEach((sec) => {
            if (
              Array.isArray(sec.temporarySubjects) &&
              sec.temporarySubjects.length > 0
            ) {
              // FIX: Safely map objects as well as raw strings
              const cleanTempSubjects = sec.temporarySubjects
                .map((s) => {
                  if (typeof s === "string") {
                    return { subjectName: s.trim() };
                  } else if (s && typeof s === "object") {
                    return {
                      subjectId: s.subjectId || null,
                      subjectName: s.subjectName ? s.subjectName.trim() : "",
                    };
                  }
                  return null;
                })
                .filter((s) => s && s.subjectName.length > 0);

              if (cleanTempSubjects.length > 0) {
                tableRows.push({
                  teacherId: teacher._id.toString(),
                  teacherName: teacher.name || "Unknown",
                  username: teacher.username || "N/A",
                  classId: cls._id ? cls._id.toString() : "",
                  className: cls.className || "N/A",
                  semesterId: sem._id ? sem._id.toString() : "",
                  semester: sem.semester || "N/A",
                  sectionId: sec._id ? sec._id.toString() : "",
                  section: sec.section || "N/A",
                  subjects: cleanTempSubjects,
                });
              }
            }
          });
        });
      });
    });

    res.render("admin/showTemporaryAssign.ejs", { tableRows });
  })
);
// 🔹 2. DELETE TEMPORARY ASSIGNMENT (BUG-FIXED & TIMETABLE-SAFE)


app.delete(
  "/delete/temporary/teacher/:teacherId/class/:classId/semester/:semesterId/section/:sectionId",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { teacherId, classId, semesterId, sectionId } = req.params;

    const session = await Teacher.startSession();
    session.startTransaction();

    try {
      const teacher = await Teacher.findById(teacherId).session(session);

      if (!teacher) {
        await session.abortTransaction();
        session.endSession();
        req.flash("error", "Teacher record not found!");
        return res.redirect("/show-temporary-teachers-assignments");
      }

      // Safe access using Mongoose .id() helper
      const targetClass = teacher.class?.id(classId);
      const targetSem = targetClass?.semesters?.id(semesterId);
      const targetSec = targetSem?.sections?.id(sectionId);

      if (!targetSec) {
        await session.abortTransaction();
        session.endSession();
        req.flash("error", "Section not found or already removed!");
        return res.redirect("/show-temporary-teachers-assignments");
      }

      // Step 1: Clear Temporary Subjects array
      targetSec.temporarySubjects = [];

      // Step 2: Fetch Active Regular Timetable subjects for this teacher in this class/sem/sec
      const activeTimetableSlots = await TimeTable.find({
        className: targetClass.className,
        semester: targetSem.semester,
        section: targetSec.section,
        teacher_id: teacher._id,
      }).session(session);

      // Step 3: FIX - Reconstruct array as Objects to match Mongoose Subdocument Schema
      const uniqueSubjectsMap = new Map();

      activeTimetableSlots.forEach((slot) => {
        if (slot.subject_name && slot.subject_name !== "🍔 LUNCH BREAK") {
          const key = slot.subject_id 
            ? slot.subject_id.toString() 
            : slot.subject_name.trim();

          if (!uniqueSubjectsMap.has(key)) {
            uniqueSubjectsMap.set(key, {
              subjectId: slot.subject_id || null,
              subjectName: slot.subject_name.trim(),
            });
          }
        }
      });

      // Valid Subdocument Objects ka Array Set kar rahe hain
      targetSec.subjects = Array.from(uniqueSubjectsMap.values());

      // Step 4: SAFE Cascading Clean-up
      // Class/Sem/Sec TABHI delete honge jab Regular Timetable me BHI koi subject na ho!
      if (targetSec.subjects.length === 0) {
        targetSem.sections.pull({ _id: sectionId });
      }

      if (targetSem.sections.length === 0) {
        targetClass.semesters.pull({ _id: semesterId });
      }

      if (targetClass.semesters.length === 0) {
        teacher.class.pull({ _id: classId });
      }

      // Mark nested structure as modified for Mongoose tracking
      teacher.markModified("class");
      await teacher.save({ session });

      await session.commitTransaction();
      session.endSession();

      req.flash(
        "success",
        "Temporary assignment deleted successfully without affecting regular timetable!"
      );
      res.redirect("/show-temporary-teachers-assignments");
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("🔥 Error deleting temporary assignment:", error);
      req.flash("error", "Something went wrong! Action safely rolled back.");
      res.redirect("/show-temporary-teachers-assignments");
    }
  })
);

// GET: Reset Academic Session Page Render
app.get(
  "/delete/teacher/subject",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    // Sabhi faculty/teachers ki list fetch karte hain jinka mapping status dikhana hai
    const teachers = await Teacher.find({});

    res.render("admin/deleteTeacherSubject.ejs", {
      teachers,
    });
  }),
);

// POST: Execute System Purge for Selected Teachers
app.post(
  "/delete/teacher/subject",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { teacherIds } = req.body;

    // Validation: Agar koi teacher select nahi kiya gaya
    if (!teacherIds || teacherIds.length === 0) {
      req.flash("error", "Please select at least one faculty member to purge.");
      return res.redirect("/delete/teacher/subject");
    }

    // Node/Express me single checkbox String deta hai, aur Multiple arrays dete hain
    const idsToUpdate = Array.isArray(teacherIds) ? teacherIds : [teacherIds];

    // Selected sabhi teachers ka 'class' array completely $set / clear kar rahe hain
    await Teacher.updateMany(
      { _id: { $in: idsToUpdate } },
      { $set: { class: [] } },
    );

    req.flash(
      "success",
      `Academic session reset completed for ${idsToUpdate.length} faculty profile(s).`,
    );
    res.redirect("/delete/teacher/subject");
  }),
);

app.get(
  "/get-subjects/:className/:semester",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className, semester } = req.params;
    const subjects = await Subject.find({
      course: className,
      semester: semester,
    });
    res.json(subjects);
  }),
);

// ------------------------------- Student Subject Assinig------------------------------------------------------------

// Get by ajax students by class & semester

app.get(
  "/get-students/:className/:semester",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { className, semester } = req.params;
    let students = await Student.find({ class: className, semester: semester });
    res.json(students);
  }),
);

// assign/student/subject/

app.get(
  "/assign/student/subject",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let teacherData = await Teacher.find({});
    let classData = await Class.find({});
    let subjectData = await Subject.find({});
    let studentData = await Student.find({});
    res.render("admin/studentAssign.ejs", {
      teacherData,
      classData,
      subjectData,
      studentData,
    });
  }),
);


// app.post(
//   "/assign/student/subject",
//   verifySession, isAdminVerified,
//   validateAssignStudent,
//   WrapAsync(async (req, res) => {
//     // 1. Transaction Session Start Karo
//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//       let { students, subjects } = req.body.data || {};

//       if (!students || !subjects) {
//         await session.abortTransaction();
//         session.endSession();
//         req.flash("error", "Students and subjects are missing!");
//         return res.redirect("/assign/student/subject");
//       }

//       if (!Array.isArray(students)) students = [students];
//       if (!Array.isArray(subjects)) subjects = [subjects];

//       // ✅ Safe JSON Parsing with try-catch
//       try {
//         subjects = subjects.map((s) =>
//           typeof s === "string" ? JSON.parse(decodeURIComponent(s)) : s,
//         );
//       } catch (parseErr) {
//         throw new Error("Invalid subject payload format!");
//       }

//       // 2. Pure Batch Ke Students Ko Ek Hi Query Mein Fetch Karo (Session Context)
//       const existingStudents = await Student.find(
//         { _id: { $in: students } },
//         "subject",
//       ).session(session);

//       const bulkOps = [];
//       let totalAssignedCount = 0;

//       // 3. In-Memory Duplication Filter (Super Fast)
//       for (const student of existingStudents) {
//         const studentExistingCodes = new Set(
//           (student.subject || []).map((s) => s.code),
//         );

//         const uniqueNewSubjects = subjects.filter(
//           (sub) => sub && sub.code && !studentExistingCodes.has(sub.code),
//         );

//         if (uniqueNewSubjects.length > 0) {
//           totalAssignedCount += uniqueNewSubjects.length;

//           // Bulk Write Operation Prepare Karo
//           bulkOps.push({
//             updateOne: {
//               filter: { _id: student._id },
//               update: { $push: { subject: { $each: uniqueNewSubjects } } },
//             },
//           });
//         }
//       }

//       // 4. Agar Operations Hain Toh Write Commit Karo
//       if (bulkOps.length > 0) {
//         await Student.bulkWrite(bulkOps, { session });
//       }

//       // ✅ SAARE UPDATES SUCCESSFUL! NOW COMMIT TRANSACTION
//       await session.commitTransaction();
//       session.endSession();

//       if (totalAssignedCount === 0) {
//         req.flash(
//           "info",
//           "All selected subjects were already assigned to these students 😄",
//         );
//       } else {
//         req.flash("success", "Subjects assigned successfully ✅");
//       }

//       return res.redirect("/assign/student/subject");
//     } catch (err) {
//       // 🚨 KOI BHI ERROR AAYA TOH TRANSACTION ROLLBACK HAR CHEEZ WAPAS PEHLE JAISI
//       await session.abortTransaction();
//       session.endSession();

//       console.error("🔥 Assign Subject Rollback Triggered Error:", err);
//       req.flash("error", `Failed to assign subjects: ${err.message}`);
//       return res.redirect("/assign/student/subject");
//     }
//   }),
// );



app.post(
  "/assign/student/subject",
  verifySession,
  isAdminVerified,
  validateAssignStudent,
  WrapAsync(async (req, res) => {
    let { students, subjects } = req.body.data || {};

    // 1. Array Normalization & Validation
    if (!students || !subjects) {
      req.flash("error", "Students and subjects are required!");
      return res.redirect("/assign/student/subject");
    }

    if (!Array.isArray(students)) students = [students];
    if (!Array.isArray(subjects)) subjects = [subjects];

    // Remove falsy values & filter valid Mongo ObjectIds for students
    students = students.filter(
      (id) => id && mongoose.Types.ObjectId.isValid(id)
    );
    subjects = subjects.filter(Boolean);

    if (students.length === 0 || subjects.length === 0) {
      req.flash("error", "Please select at least one valid student and subject!");
      return res.redirect("/assign/student/subject");
    }

    // 2. Safe Payload Sanitization & ObjectId Conversion
    let sanitizedSubjects = [];
    try {
      sanitizedSubjects = subjects.map((s) => {
        let parsed = s;

        if (typeof s === "string") {
          try {
            parsed = JSON.parse(decodeURIComponent(s));
          } catch (_) {
            parsed = JSON.parse(s);
          }
        }

        const rawId = parsed.subjectId || parsed._id;
        if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
          throw new Error("Invalid Subject ID detected!");
        }

        return {
          subjectId: new mongoose.Types.ObjectId(rawId),
          name: String(parsed.name || "").trim(),
          code: String(parsed.code || "").trim(),
          maxMarks: Number(parsed.maxMarks) || 0,
          minMarks: Number(parsed.minMarks) || 0,
          subjectType: String(parsed.subjectType || "").trim(),
        };
      });
    } catch (parseErr) {
      req.flash("error", "Invalid subject payload format!");
      return res.redirect("/assign/student/subject");
    }

    // 3. Payload Deduplication (In-Memory Request Level)
    const seenPayloadIds = new Set();
    const seenPayloadCodes = new Set();

    sanitizedSubjects = sanitizedSubjects.filter((sub) => {
      const idStr = String(sub.subjectId);
      const codeStr = sub.code.toLowerCase();

      if (seenPayloadIds.has(idStr) || (codeStr && seenPayloadCodes.has(codeStr))) {
        return false;
      }

      seenPayloadIds.add(idStr);
      if (codeStr) seenPayloadCodes.add(codeStr);
      return true;
    });

    // 4. DB Query for Selected Students
    const existingStudents = await Student.find(
      { _id: { $in: students } },
      "_id subject"
    );

    const bulkOps = [];
    let totalAssignedCount = 0;

    // 5. DB Level Duplication Check
    for (const student of existingStudents) {
      const existingSubjectIds = new Set();
      const existingCodes = new Set();

      (student.subject || []).forEach((sub) => {
        if (sub.subjectId) existingSubjectIds.add(String(sub.subjectId));
        if (sub.code) existingCodes.add(String(sub.code).toLowerCase());
      });

      const uniqueNewSubjects = sanitizedSubjects.filter((sub) => {
        const subIdStr = String(sub.subjectId);
        const subCodeStr = sub.code.toLowerCase();

        const isIdExist = existingSubjectIds.has(subIdStr);
        const isCodeExist = subCodeStr && existingCodes.has(subCodeStr);

        return !isIdExist && !isCodeExist;
      });

      if (uniqueNewSubjects.length > 0) {
        totalAssignedCount += uniqueNewSubjects.length;

        bulkOps.push({
          updateOne: {
            filter: { _id: student._id },
            update: { $push: { subject: { $each: uniqueNewSubjects } } },
          },
        });
      }
    }

    // 6. Fast Bulk Execution
    if (bulkOps.length > 0) {
      await Student.bulkWrite(bulkOps);
    }

    // 7. Flash & Redirect (PRG Compliant)
    if (totalAssignedCount === 0) {
      req.flash(
        "info",
        "All selected subjects were already assigned to these students 😄"
      );
    } else {
      req.flash(
        "success",
        `Subjects assigned successfully to ${bulkOps.length} student(s) ✅`
      );
    }

    return res.redirect("/assign/student/subject");
  })
);
//------------------------------------- Admin Attendance status ----------------------------------------------//

//  check today attendance record

app.get(
  "/show/status/today/attendance",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let classData = await Class.find({});
    let sectionData = await Section.find({});
    res.render("admin/todayAttendancelogin.ejs", { classData, sectionData });
  }),
);

app.post(
  "/show/status/today/attendance",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { data } = req.body;

    if (!data.class || !data.semester || !data.section) {
      req.flash("error", "Class, semester or section missing");
      return res.redirect("/show/status/today/attendance");
    }

    // req.session.className = data.class;
    // req.session.semester = data.semester;
    // req.session.section = data.section;

    // 🔹 Students
    const students = await Student.find({
      class: data.class,
      semester: data.semester,
      section: data.section,
    });

    if (!students.length) {
      req.flash("error", "No students found");
      return res.redirect("/show/status/today/attendance");
    }

    // 🔹 TODAY RANGE
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 🔹 TODAY ATTENDANCE ONLY
    let attendance = await Attendance.find({
      date: { $gte: startOfDay, $lte: endOfDay },
    }).populate({
      path: "studentId",
      match: {
        class: data.class,
        semester: data.semester,
        section: data.section,
      },
    });

    attendance = attendance.filter((a) => a.studentId);

    res.render("admin/showTodayRecord.ejs", {
      students,
      attendance,
      today: new Date(),
    });
  }),
);

app.post(
  "/show/today/status/attendance/date",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { data } = req.body || {};

    // ❌ Check if data object or required fields are missing
    if (
      !data ||
      !data.className ||
      !data.semester ||
      !data.section ||
      !data.date
    ) {
      req.flash(
        "error",
        "All fields (Class, Semester, Section, Date) are required!",
      );
      return res.redirect("/show/status/today/attendance");
    }

    // 🔹 Destructure values safely in a single line
    const { className, semester, section, date } = data;

    // ✅ SAFE UTC DATE PARSING
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      req.flash("error", "Invalid date");
      return res.redirect("/show/status/today/attendance");
    }

    // 🔥 FORCE UTC MIDNIGHT
    selectedDate.setUTCHours(0, 0, 0, 0);

    // 🔹 DAY RANGE (UTC)
    const start = new Date(selectedDate);
    const end = new Date(selectedDate);
    end.setUTCHours(23, 59, 59, 999);

    // 🔹 STUDENTS
    const students = await Student.find({
      class: className,
      semester: semester,
      section: section,
    });

    if (!students.length) {
      req.flash("error", "No students found");
      return res.redirect("/show/status/today/attendance");
    }

    // 🔹 ATTENDANCE (DATE + CLASS FILTER)
    let attendance = await Attendance.find({
      date: { $gte: start, $lte: end },
    }).populate({
      path: "studentId",
      match: {
        class: className,
        semester: semester,
        section: section,
      },
    });

    // 🔹 REMOVE NULL POPULATED
    attendance = attendance.filter((a) => a.studentId);

    // ✅ RENDER SAME PAGE
    res.render("admin/TodayRecordDateWise.ejs", {
      students,
      attendance,
      today: selectedDate,
    });
  }),
);

app.get(
  "/show/today/status/attendance/pdf",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { class: className, semester, section, date } = req.query;

    const d = new Date(date);
    const start = new Date(d.setHours(0, 0, 0, 0));
    const end = new Date(d.setHours(23, 59, 59, 999));

    // ===== STUDENTS =====
    const students = await Student.find({
      class: className,
      semester,
      section,
    }).sort({ rollNo: 1 });

    const studentIds = students.map((s) => s._id);

    // ===== ATTENDANCE (ONLY THESE STUDENTS) =====
    const attendance = await Attendance.find({
      studentId: { $in: studentIds },
      date: { $gte: start, $lte: end },
    });

    // ===== PERIOD DATA =====
    const periodMap = {};
    attendance.forEach((a) => {
      if (!periodMap[a.period]) {
        periodMap[a.period] = {
          teacher: a.teacherName || "-",
          subject: a.subject || "-",
          unit: a.unit || "-",
          description: a.description || "-",
        };
      }
    });

    const doc = new PDFDocument({ margin: 30, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Daily_Attendance_${className}.pdf`,
    );

    doc.pipe(res);

    // ================= HEADER =================
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("Daily Attendance Report", { align: "center" });

    doc.moveDown(0.8);

    doc
      .font("Helvetica")
      .fontSize(11)
      .text(`Class    : ${className}`)
      .text(`Semester : ${semester}`)
      .text(`Section  : ${section}`)
      .text(`Date     : ${new Date(date).toDateString()}`);

    doc.moveDown(0.6);

    doc.moveTo(30, doc.y).lineTo(565, doc.y).stroke();
    doc.moveDown(1);

    // ================= STUDENT TABLE =================
    const table = {
      headers: [
        "Adm No",
        "Name",
        "Father Name",
        "I",
        "II",
        "III",
        "IV",
        "V",
        "VI",
      ],
      rows: students.map((stu) => {
        const row = [stu.rollNo, stu.name, stu.fatherName || "-"];

        for (let p = 1; p <= 6; p++) {
          const rec = attendance.find(
            (a) =>
              a.studentId.toString() === stu._id.toString() && a.period === p,
          );
          row.push(rec ? (rec.status === "Present" ? "P" : "A") : "-");
        }

        return row;
      }),
    };

    doc.table(table, {
      width: 560,
      columnsSize: [60, 90, 110, 40, 40, 40, 40, 40, 40],
      padding: 7,
      columnSpacing: 5,
      prepareHeader: () => doc.font("Helvetica-Bold").fontSize(11),
      prepareRow: () => {
        doc.font("Helvetica").fontSize(10);
        doc.moveDown(0.25);
      },
    });

    // ================= GAP =================
    doc.moveDown(1.4);

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Period Wise Teaching Details");

    doc.moveDown(0.5);

    // ================= EXTRA INFO TABLE =================
    const extraTable = {
      headers: ["", "I", "II", "III", "IV", "V", "VI"],
      rows: [
        [
          "Teacher",
          periodMap[1]?.teacher || "-",
          periodMap[2]?.teacher || "-",
          periodMap[3]?.teacher || "-",
          periodMap[4]?.teacher || "-",
          periodMap[5]?.teacher || "-",
          periodMap[6]?.teacher || "-",
        ],
        [
          "Subject",
          periodMap[1]?.subject || "-",
          periodMap[2]?.subject || "-",
          periodMap[3]?.subject || "-",
          periodMap[4]?.subject || "-",
          periodMap[5]?.subject || "-",
          periodMap[6]?.subject || "-",
        ],
        [
          "Unit",
          periodMap[1]?.unit || "-",
          periodMap[2]?.unit || "-",
          periodMap[3]?.unit || "-",
          periodMap[4]?.unit || "-",
          periodMap[5]?.unit || "-",
          periodMap[6]?.unit || "-",
        ],
        [
          "Description",
          periodMap[1]?.description || "-",
          periodMap[2]?.description || "-",
          periodMap[3]?.description || "-",
          periodMap[4]?.description || "-",
          periodMap[5]?.description || "-",
          periodMap[6]?.description || "-",
        ],
      ],
    };

    doc.table(extraTable, {
      width: 560,
      columnsSize: [100, 75, 75, 75, 75, 75, 75],
      padding: 8,
      columnSpacing: 5,
      prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
      prepareRow: () => {
        doc.font("Helvetica").fontSize(9);
        doc.moveDown(0.3);
      },
    });

    // ================= FOOTER =================
    doc.moveDown(1.5);

    doc
      .fontSize(9)
      .fillColor("gray")
      .text("MITHLA — Simplifying Academic Attendance Management", {
        align: "center",
      })
      .fillColor("black");

    doc.end();
  }),
);

app.post(
  "/show/today/status/attendance/date/pdf",
 verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { data } = req.body || {};

    // ❌ Check if data object or required fields are missing
    if (
      !data ||
      !data.className ||
      !data.semester ||
      !data.section ||
      !data.date
    ) {
      req.flash(
        "error",
        "All fields (Class, Semester, Section, Date) are required!",
      );
      return res.redirect("/show/status/today/attendance");
    }

    // 🔹 Destructure values safely in a single line
    const { className, semester, section, date } = data;

    // ===== DATE RANGE =====
    const selectedDate = new Date(date);
    selectedDate.setUTCHours(0, 0, 0, 0);

    const start = new Date(selectedDate);
    const end = new Date(selectedDate);
    end.setUTCHours(23, 59, 59, 999);

    // ===== STUDENTS =====
    const students = await Student.find({
      class: className,
      semester,
      section,
    });

    // ===== ATTENDANCE =====
    let attendance = await Attendance.find({
      date: { $gte: start, $lte: end },
    }).populate("studentId");

    attendance = attendance.filter(
      (a) =>
        a.studentId &&
        a.studentId.class === className &&
        a.studentId.semester === semester &&
        a.studentId.section === section,
    );

    // ===== PDF INIT =====
    const doc = new PDFDocument({ margin: 30, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=attendance-${date}.pdf`,
    );

    doc.pipe(res);

    // ================= HEADER =================
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("Daily Attendance Report", { align: "center" });

    doc.moveDown(0.8);

    doc
      .font("Helvetica")
      .fontSize(11)
      .text(`Class    : ${className}`)
      .text(`Semester : ${semester}`)
      .text(`Section  : ${section}`)
      .text(`Date     : ${date}`);

    doc.moveDown(0.6);

    // divider
    doc.moveTo(30, doc.y).lineTo(565, doc.y).stroke();
    doc.moveDown(1);

    // ================= STUDENT TABLE =================
    const studentTable = {
      headers: [
        "Adm No",
        "Name",
        "Father Name",
        "I",
        "II",
        "III",
        "IV",
        "V",
        "VI",
      ],
      rows: [],
    };

    students.forEach((stu) => {
      const row = [
        stu.rollNo,
        stu.name,
        stu.fatherName || "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
      ];

      for (let p = 1; p <= 6; p++) {
        const rec = attendance.find(
          (a) =>
            a.studentId._id.toString() === stu._id.toString() && a.period === p,
        );
        row[p + 2] = rec ? (rec.status === "Present" ? "P" : "A") : "-";
      }

      studentTable.rows.push(row);
    });

    await doc.table(studentTable, {
      width: 560,
      padding: 7,
      columnSpacing: 5,
      prepareHeader: () => doc.font("Helvetica-Bold").fontSize(11),
      prepareRow: () => {
        doc.font("Helvetica").fontSize(10);
        doc.moveDown(0.25);
      },
    });

    // ================= GAP + TITLE =================
    doc.moveDown(1.4);
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Period Wise Teaching Details");

    doc.moveDown(0.5);

    // ================= INFO TABLE =================
    const makeInfoRow = (title, field) => {
      const row = [title, "", ""];
      for (let p = 1; p <= 6; p++) {
        const rec = attendance.find((a) => a.period === p);
        row.push(rec?.[field] || "-");
      }
      return row;
    };

    const infoTable = {
      headers: ["", "", "", "I", "II", "III", "IV", "V", "VI"],
      rows: [
        makeInfoRow("Teacher", "teacherName"),
        makeInfoRow("Subject", "subject"),
        makeInfoRow("Unit", "unit"),
        makeInfoRow("Description", "description"),
      ],
    };

    await doc.table(infoTable, {
      width: 560,
      padding: 8,
      columnSpacing: 5,
      prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
      prepareRow: () => {
        doc.font("Helvetica").fontSize(9);
        doc.moveDown(0.3);
      },
    });

    // ================= FOOTER =================
    doc.moveDown(1.5);
    doc
      .fontSize(9)
      .fillColor("gray")
      .text("MITHLA — Simplifying Academic Attendance Management", {
        align: "center",
      })
      .fillColor("black");

    doc.end();
  }),
);

// check all status of Totalstudent

app.get(
  "/show/allStudent/status",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let classData = await Class.find({});
    let sectionData = await Section.find({});
    res.render("admin/AllstudentAttendanceStatuslogin.ejs", {
      classData,
      sectionData,
    });
  }),
);

// ---------------------filter---------

app.post(
  "/show/allStudent/status/filter",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { class: className, semester, section, filter } = req.body;

    // default filter
    if (!filter) filter = "all";

    let dateQuery = {};
    const now = new Date();

    // ===== TODAY =====
    if (filter === "today") {
      const start = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          0,
          0,
          0,
          0,
        ),
      );
      const end = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      );
      dateQuery = { $gte: start, $lte: end };
    }

    // ===== WEEKLY (Sun–Sat) =====
    if (filter === "weekly") {
      const day = now.getUTCDay(); // Sunday = 0
      const startOfWeek = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - day,
          0,
          0,
          0,
          0,
        ),
      );
      const endOfWeek = new Date(
        Date.UTC(
          startOfWeek.getUTCFullYear(),
          startOfWeek.getUTCMonth(),
          startOfWeek.getUTCDate() + 6,
          23,
          59,
          59,
          999,
        ),
      );
      dateQuery = { $gte: startOfWeek, $lte: endOfWeek };
    }

    // ===== MONTHLY =====
    if (filter === "monthly") {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
      );
      const end = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        ),
      );
      dateQuery = { $gte: start, $lte: end };
    }

    // ===== STUDENTS =====
    const students = await Student.find({
      class: className,
      semester,
      section,
    });

    const studentIds = students.map((s) => s._id);

    // ===== ATTENDANCE =====
    const attendanceQuery = {
      studentId: { $in: studentIds },
    };

    if (filter !== "all") {
      attendanceQuery.date = dateQuery;
    }

    const attendance = await Attendance.find(attendanceQuery);

    // ===== REPORT =====
    const report = students.map((student) => {
      const records = attendance.filter(
        (a) => a.studentId.toString() === student._id.toString(),
      );

      // 🔹 PERIOD COUNTS
      const totalPeriods = records.length;
      const presentPeriods = records.filter(
        (r) => r.status === "Present",
      ).length;

      // 🔹 DAY-WISE COUNTS
      const dayMap = {};

      records.forEach((r) => {
        const day = r.date.toISOString().split("T")[0];

        if (!(day in dayMap)) {
          dayMap[day] = "Absent";
        }

        // ek bhi present → pura din present
        if (r.status === "Present") {
          dayMap[day] = "Present";
        }
      });

      const totalDays = Object.keys(dayMap).length;
      const presentDays = Object.values(dayMap).filter(
        (v) => v === "Present",
      ).length;

      const percentage =
        totalDays === 0 ? 0 : Math.round((presentDays / totalDays) * 100);

      let status = "SHORT";
      if (percentage >= 75) status = "GOOD";
      else if (percentage >= 60) status = "WARNING";

      return {
        rollNo: student.rollNo,
        name: student.name,
        fatherName: student.fatherName,

        // day-wise
        presentDays,
        totalDays,
        percentage,
        status,

        // period-wise
        presentPeriods,
        totalPeriods,
      };
    });

    res.json(report);
  }),
);

app.post(
  "/show/allStudent/status",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { data } = req.body;
    const { class: className, semester, section } = data;

    if (!className || !semester || !section) {
      req.flash("error", "Class, semester, or section not found");
      return res.redirect("/show/allStudent/status");
    }

    // ===== STUDENTS =====
    const students = await Student.find({
      class: className,
      semester,
      section,
    });

    if (!students.length) {
      req.flash("error", "No student datas found");
      return res.redirect("/show/allStudent/status");
    }

    const studentIds = students.map((s) => s._id);

    // ===== ATTENDANCE (ALL DATA) =====
    const attendance = await Attendance.find({
      studentId: { $in: studentIds },
    });

    // ===== REPORT (SAME AS FILTER ROUTE) =====
    const report = students.map((student) => {
      const records = attendance.filter(
        (a) => a.studentId.toString() === student._id.toString(),
      );

      // 🔹 PERIOD COUNTS
      const totalPeriods = records.length;
      const presentPeriods = records.filter(
        (r) => r.status === "Present",
      ).length;

      // 🔹 DAY-WISE LOGIC (6 period → 1 present = present day)
      const dayMap = {};

      records.forEach((r) => {
        const day = r.date.toISOString().split("T")[0];

        if (!(day in dayMap)) {
          dayMap[day] = "Absent";
        }

        if (r.status === "Present") {
          dayMap[day] = "Present";
        }
      });

      const totalDays = Object.keys(dayMap).length;
      const presentDays = Object.values(dayMap).filter(
        (v) => v === "Present",
      ).length;

      const percentage =
        totalDays === 0 ? 0 : Math.round((presentDays / totalDays) * 100);

      let status = "SHORT";
      if (percentage >= 75) status = "GOOD";
      else if (percentage >= 60) status = "WARNING";

      return {
        rollNo: student.rollNo,
        name: student.name,
        fatherName: student.fatherName,

        // day-wise
        presentDays,
        totalDays,
        percentage,
        status,

        // period-wise
        presentPeriods,
        totalPeriods,
      };
    });

    // ===== RENDER =====
    res.render("admin/AllstudentAttendanceStatus.ejs", {
      report,
      className,
      semester,
      section,
    });
  }),
);

// pdf for student status

app.get(
  "/show/allStudent/status/pdf",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { class: className, semester, section, filter } = req.query;

    if (!filter) filter = "all";

    let dateQuery = {};
    const now = new Date();

    // ===== DATE FILTER =====
    if (filter === "today") {
      const start = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          0,
          0,
          0,
          0,
        ),
      );
      const end = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      );
      dateQuery = { $gte: start, $lte: end };
    }

    if (filter === "weekly") {
      const day = now.getUTCDay();
      const start = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - day,
          0,
          0,
          0,
          0,
        ),
      );
      const end = new Date(
        Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth(),
          start.getUTCDate() + 6,
          23,
          59,
          59,
          999,
        ),
      );
      dateQuery = { $gte: start, $lte: end };
    }

    if (filter === "monthly") {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
      );
      const end = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        ),
      );
      dateQuery = { $gte: start, $lte: end };
    }

    // ===== STUDENTS =====
    const students = await Student.find({
      class: className,
      semester,
      section,
    });

    const studentIds = students.map((s) => s._id);

    // ===== ATTENDANCE =====
    const attendanceQuery = {
      studentId: { $in: studentIds },
    };

    if (filter !== "all") {
      attendanceQuery.date = dateQuery;
    }

    const attendance = await Attendance.find(attendanceQuery);

    // ===== REPORT (SAME LOGIC AS FILTER ROUTE) =====
    const report = students.map((student) => {
      const records = attendance.filter(
        (a) => a.studentId.toString() === student._id.toString(),
      );

      // 🔹 PERIOD COUNTS
      const totalPeriods = records.length;
      const presentPeriods = records.filter(
        (r) => r.status === "Present",
      ).length;

      // 🔹 DAY-WISE COUNTS
      const dayMap = {};

      records.forEach((r) => {
        const day = r.date.toISOString().split("T")[0];

        if (!(day in dayMap)) {
          dayMap[day] = "Absent";
        }

        if (r.status === "Present") {
          dayMap[day] = "Present";
        }
      });

      const totalDays = Object.keys(dayMap).length;
      const presentDays = Object.values(dayMap).filter(
        (v) => v === "Present",
      ).length;

      const percentage =
        totalDays === 0 ? 0 : Math.round((presentDays / totalDays) * 100);

      let status = "SHORT";
      if (percentage >= 75) status = "GOOD";
      else if (percentage >= 60) status = "WARNING";

      return {
        rollNo: student.rollNo,
        name: student.name,
        fatherName: student.fatherName,

        presentDays,
        totalDays,
        presentPeriods,
        totalPeriods,
        percentage,
        status,
      };
    });

    // ===== PDF =====
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Attendance_Status_${className}.pdf`,
    );

    doc.pipe(res);

    // ===== HEADER =====
    doc
      .fontSize(18)
      .text("Student Attendance Status Report", { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .text(`Class: ${className} | Sem: ${semester} | Sec: ${section}`, {
        align: "center",
      });
    doc
      .fontSize(11)
      .text(`Filter: ${filter.toUpperCase()}`, { align: "center" });
    doc.moveDown(1);

    // ===== TABLE HEADER =====
    let y = doc.y;
    doc.fontSize(10).font("Helvetica-Bold");

    doc.text("Adm.no", 40, y);
    doc.text("Name", 110, y);
    doc.text("FatherName", 200, y);

    doc.text("P Days", 310, y);
    doc.text("T Days", 350, y);
    doc.text("P Per.", 390, y);
    doc.text("T Per.", 430, y);
    doc.text("%", 470, y);
    doc.text("Status", 510, y);

    doc.moveDown(0.3);
    doc.font("Helvetica").moveTo(40, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    // ===== TABLE ROWS =====
    report.forEach((r) => {
      let rowY = doc.y;

      doc.text(r.rollNo, 40, rowY);
      doc.text(r.name, 90, rowY);
      doc.text(r.fatherName, 200, rowY);
      doc.text(r.presentDays, 320, rowY);
      doc.text(r.totalDays, 360, rowY);
      doc.text(r.presentPeriods, 400, rowY);
      doc.text(r.totalPeriods, 440, rowY);
      doc.text(`${r.percentage}%`, 470, rowY);
      doc.text(r.status, 510, rowY);

      doc.moveDown(0.6);

      if (doc.y > 750) doc.addPage();
    });

    // ===== FOOTER =====
    doc.moveDown(2);
    doc
      .fontSize(9)
      .text(`Generated on: ${new Date().toLocaleString()}`, { align: "right" });

    doc.end();
  }),
);

// ----------------------------------------------------Admin Show Students feeds ------------------------------------

app.get(
  "/admin/show/feed",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    const { new: isNew, class: classFilter, name } = req.query;

    /* 🔹 Feed filter (NEW) */
    let feedFilter = {};
    if (isNew === "true") feedFilter.isRead = false;

    /* 🔹 Student filter (CLASS + NAME) */
    let studentMatch = {};
    if (classFilter) studentMatch.class = classFilter;
    if (name) studentMatch.name = { $regex: name, $options: "i" };

    /* 🔹 Total count for pagination */
    const countFeeds = await Feed.find(feedFilter).populate({
      path: "studentId",
      select: "name class semester",
      match: studentMatch,
    });

    const totalCount = countFeeds.filter((f) => f.studentId).length;
    const totalPages = Math.ceil(totalCount / limit);

    /* 🔹 Fetch paginated data */
    const feedsRaw = await Feed.find(feedFilter)
      .populate({
        path: "studentId",
        select: "name class semester fatherName session",
        match: studentMatch,
      })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    const feeds = feedsRaw.filter((f) => f.studentId);

    /* 🔹 Classes */
    const classData = await Class.find({});

    res.render("admin/showFeed.ejs", {
      feeds,
      classData,
      page,
      totalPages,
      isNewFilter: isNew === "true",
      selectedClass: classFilter || "",
      searchName: name || "",
    });
  }),
);

app.post(
  "/admin/feed/read/:id",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    await Feed.findByIdAndUpdate(id, { isRead: true });
    res.redirect("/admin/show/feed"); // same page reload
  }),
);

app.get(
  "/admin/analytics",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const total = await Feed.countDocuments();
    const unread = await Feed.countDocuments({ isRead: false });
    const today = await Feed.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    });

    res.json({ total, unread, today });
  }),
);

// delete Feed

app.delete(
  "/admin/feed/delete/:id",
 verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    let data = await Feed.findByIdAndDelete(id);
    // console.log(data);
    req.flash("success", "Delete successfully");
    res.redirect("/admin/show/feed");
  }),
);

//------------------------------------Student updation class semester --------------------------------------

app.get(
  "/student/update/class/semester",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let classData = await Class.find({});
    res.render("admin/updateStudentClass&Semester.ejs", { classData });
  }),
);

app.post("/student/update/class/semester",  verifySession, isAdminVerified,WrapAsync(async (req, res) => {
  const { currentClass, currentSemester, newClass, newSemester } =
    req.body.data;

  // 🔴 Check if any field is missing
  if (!currentClass || !currentSemester || !newClass || !newSemester) {
    req.flash("error", "All fields are required.");
    return res.redirect("/student/update/class/semester");
  }

  // 🔴 Prevent same class & semester update
  if (currentClass === newClass && currentSemester == newSemester) {
    req.flash("error", "Current and new class/semester cannot be the same.");
    return res.redirect("/student/update/class/semester");
  }

  const result = await Student.updateMany(
    { class: currentClass, semester: currentSemester },
    { $set: { class: newClass, semester: newSemester } },
  );

  if (result.matchedCount === 0) {
    req.flash(
      "error",
      "No students found for the selected class and semester.",
    );
    return res.redirect("/student/update/class/semester");
  }

  req.flash(
    "success",
    `${result.modifiedCount} students updated successfully!`,
  );

  res.redirect("/student/update/class/semester");
}));

// delete student subject

app.get(
  "/student/subject/delete",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let classData = await Class.find({});
    res.render("admin/deleteStudentSubject.ejs", { classData });
  }),
);

app.post(
  "/student/subject/delete",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    try {
      const { currentClass, currentSemester } = req.body.data;

      if (!currentClass || !currentSemester) {
        req.flash("error", "Class and Semester are required!");
        return res.redirect("/student/subject/delete");
      }

      const result = await Student.updateMany(
        {
          class: currentClass,
          semester: currentSemester, // ✅ string match
        },
        {
          $set: { subject: [] },
        },
      );

      if (result.matchedCount === 0) {
        req.flash(
          "error",
          "No students found for the selected class and semester.",
        );
        return res.redirect("/student/subject/delete");
      }

      req.flash(
        "success",
        `${result.modifiedCount} students' subjects cleared successfully`,
      );

      res.redirect("/student/subject/delete");
    } catch (err) {
      console.error("Subject Delete Error:", err);
      req.flash("error", "Something went wrong!");
      return res.redirect("/student/subject/delete");
    }
  }),
);

//       delete students

app.get(
  "/student/bulk-delete",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let classData = await Class.find({});
    res.render("admin/bulkDeleteStudent.ejs", { classData });
  }),
);

app.post(
  "/student/bulk-delete-now",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { currentClass, currentSemester } = req.body.data;

    if (!currentClass || !currentSemester) {
      req.flash("error", "Class and Semester fields are required!");
      return res.redirect("/student/bulk-delete");
    }

    const result = await Student.deleteMany({
      class: currentClass,
      semester: currentSemester,
    });

    if (result.deletedCount === 0) {
      req.flash(
        "error",
        "No students found in the selected Class and Semester!",
      );
      return res.redirect("/student/bulk-delete");
    }

    req.flash(
      "success",
      `Successfully deleted ${result.deletedCount} students and their linked attendance records.`,
    );
    res.redirect("/student/bulk-delete");
  }),
);





//----------------------------------- ADD  COURSE HOD & CLASS INCHARGE --------------------------------------



const ClassIncharge = require("./models/classIncharge.js");
const Hod = require("./models/hodSchema.js");

const {
  validateClassIncharge,
  validateHod,
} = require("./schema/classIncharge.js");


// ======================================================
// HELPER FUNCTIONS FOR STRING SANITIZATION
// ======================================================
const cleanString = (value) => {
  if (value === undefined || value === null) return "";
  return value.toString().trim().replace(/\s+/g, " ").toUpperCase();
};

const cleanCourseForHod = (courseName) => {
  let course = cleanString(courseName);
  if (!course) return "";

  course = course
    .replace(/\s*[-_]?\s*(?:1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH)\s*(?:YEAR)?\s*$/i, "")
    .replace(/\s*[-_]?\s*(?:YEAR|SEM|SEMESTER)\s*\d+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return course;
};

// ======================================================
// 1. GET ASSIGNMENT PAGE
// ======================================================
app.get(
  "/admin/add/class/incharge",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const [classData, section, teacher, assignedIncharges, assignedHods] =
      await Promise.all([
        Class.find({}).sort({ class: 1 }).lean(),
        Section.find({}).sort({ name: 1 }).lean(),
        Teacher.find({}).sort({ name: 1 }).lean(),
        ClassIncharge.find({})
          .populate("teacher", "name department")
          .sort({ createdAt: -1 })
          .lean(),
        Hod.find({})
          .populate("teacher", "name department")
          .sort({ courseName: 1 })
          .lean(),
      ]);

    // const semesters = ["1", "2", "3", "4", "5", "6", "7", "8"];

    return res.render("admin/addIncharge", {
      classData,
      section,
      teacher,
      // semesters,
      assignedIncharges,
      assignedHods,
    });
  })
);

// ======================================================
// 2. SAVE CLASS INCHARGE
// ======================================================
app.post(
  "/admin/save/class-incharge",
  verifySession,
  isAdminVerified,
  validateClassIncharge,
  WrapAsync(async (req, res) => {
    const { className, semester, sectionName, teacherId } = req.body;

    const cleanClass = cleanString(className);
    const cleanSem = cleanString(semester);
    const cleanSec = cleanString(sectionName);

    if (!cleanClass || !cleanSem || !cleanSec || !teacherId) {
      req.flash("error", "Class, Semester, Section and Teacher are required.");
      return res.redirect("/admin/add/class/incharge");
    }

    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      req.flash("error", "Invalid Teacher selected.");
      return res.redirect("/admin/add/class/incharge");
    }

    const teacherObj = await Teacher.findById(teacherId).lean();
    if (!teacherObj) {
      req.flash("error", "Selected teacher does not exist.");
      return res.redirect("/admin/add/class/incharge");
    }

    const teacherAssignment = await ClassIncharge.findOne({
      teacher: teacherObj._id,
    }).lean();

    if (teacherAssignment) {
      const sameSlot =
        teacherAssignment.className === cleanClass &&
        teacherAssignment.semester === cleanSem &&
        teacherAssignment.sectionName === cleanSec;

      if (!sameSlot) {
        req.flash(
          "error",
          `Teacher "${teacherObj.name}" is already Class Incharge of ${teacherAssignment.className} - Sem ${teacherAssignment.semester} - Sec ${teacherAssignment.sectionName}.`
        );
        return res.redirect("/admin/add/class/incharge");
      }
    }

    try {
      await ClassIncharge.findOneAndUpdate(
        { className: cleanClass, semester: cleanSem, sectionName: cleanSec },
        {
          $set: {
            className: cleanClass,
            semester: cleanSem,
            sectionName: cleanSec,
            teacher: teacherObj._id,
          },
        },
        { upsert: true, runValidators: true }
      );

      req.flash("success", `Class Incharge updated successfully.`);
      return res.redirect("/admin/add/class/incharge");
    } catch (error) {
      if (error.code === 11000) {
        req.flash(
          "error",
          "This teacher is already assigned to another Class Incharge slot."
        );
        return res.redirect("/admin/add/class/incharge");
      }
      throw error;
    }
  })
);

// ======================================================
// 3. SAVE HOD
// ======================================================
app.post(
  "/admin/save/hod",
  verifySession,
  isAdminVerified,
  validateHod,
  WrapAsync(async (req, res) => {
    const { courseName, teacherId } = req.body;
    const cleanedCourse = cleanCourseForHod(courseName);

    if (!cleanedCourse || !teacherId) {
      req.flash("error", "Course/Department and Teacher are required.");
      return res.redirect("/admin/add/class/incharge");
    }

    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      req.flash("error", "Invalid Teacher selected.");
      return res.redirect("/admin/add/class/incharge");
    }

    const teacherObj = await Teacher.findById(teacherId).lean();
    if (!teacherObj) {
      req.flash("error", "Selected teacher does not exist.");
      return res.redirect("/admin/add/class/incharge");
    }

    const teacherHod = await Hod.findOne({ teacher: teacherObj._id }).lean();
    if (teacherHod) {
      const sameCourse =
        cleanString(teacherHod.courseName) === cleanString(cleanedCourse);

      if (!sameCourse) {
        req.flash(
          "error",
          `Teacher "${teacherObj.name}" is already HOD of "${teacherHod.courseName}".`
        );
        return res.redirect("/admin/add/class/incharge");
      }
    }

    try {
      await Hod.findOneAndUpdate(
        { courseName: cleanedCourse },
        { $set: { courseName: cleanedCourse, teacher: teacherObj._id } },
        { upsert: true, runValidators: true }
      );

      req.flash("success", `Department HOD updated successfully.`);
      return res.redirect("/admin/add/class/incharge");
    } catch (error) {
      if (error.code === 11000) {
        req.flash(
          "error",
          "This teacher is already assigned as HOD of another course."
        );
        return res.redirect("/admin/add/class/incharge");
      }
      throw error;
    }
  })
);

// ======================================================
// 4. DELETE CLASS INCHARGE
// ======================================================
app.post(
  "/admin/delete/class-incharge/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash("error", "Invalid Class Incharge ID.");
      return res.redirect("/admin/add/class/incharge");
    }

    const deleted = await ClassIncharge.findByIdAndDelete(id);
    if (!deleted) {
      req.flash("error", "Class Incharge assignment not found.");
      return res.redirect("/admin/add/class/incharge");
    }

    req.flash("success", "Class Incharge removed successfully.");
    return res.redirect("/admin/add/class/incharge");
  })
);

// ======================================================
// 5. DELETE HOD
// ======================================================
app.post(
  "/admin/delete/hod/:id",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      req.flash("error", "Invalid HOD ID.");
      return res.redirect("/admin/add/class/incharge");
    }

    const deleted = await Hod.findByIdAndDelete(id);
    if (!deleted) {
      req.flash("error", "HOD assignment not found.");
      return res.redirect("/admin/add/class/incharge");
    }

    req.flash("success", "Department HOD removed successfully.");
    return res.redirect("/admin/add/class/incharge");
  })
);


// ======================================================
// 6. API TO SHOW CLASS INCHARGE ON TIME TABLE PAGE
// ======================================================
app.get('/api/get-class-incharge', verifySession,isAdminVerified, WrapAsync( async (req, res) => {
  try {
    const { className } = req.query;

    if (!className) {
      return res.status(400).json({
        success: false,
        message: "className query parameter is required"
      });
    }

    // Selected course ke saare sections/semesters ke incharges find karein
    // Aur teacher reference ki name details populate karein
    const incharges = await ClassIncharge.find({ className: className })
      .populate('teacher', 'name') // Jo teacher fields chahiye
      .exec();

    return res.status(200).json({
      success: true,
      count: incharges.length,
      incharges: incharges
    });

  } catch (error) {
    console.error("Error fetching class incharges:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching incharges",
      error: error.message
    });
  }
}));

// ======================================================
//  6. API TO SHOW COURSE HOD ON TIME TABLE PAGE
// ======================================================
app.get(
  "/api/get-hod",
  verifySession,isAdminVerified, WrapAsync(async (req, res) => {
    const { courseName } = req.query;

    // Existing cleanCourseForHod helper function ka use
    const cleanedCourse = cleanCourseForHod(courseName);

    if (!cleanedCourse) {
      return res.status(400).json({
        success: false,
        message: "Valid courseName parameter is required.",
      });
    }

    const hod = await Hod.findOne({ courseName: cleanedCourse })
      .populate("teacher", "name")
      .lean();

    if (!hod) {
      return res.status(200).json({
        success: true,
        hod: null,
        message: "No HOD found for this department.",
      });
    }

    return res.status(200).json({
      success: true,
      hod,
    });
  })
);
// // ======================================================
// // GENERAL STRING CLEANER
// // ======================================================
// const cleanString = (value) => {
//   if (value === undefined || value === null) {
//     return "";
//   }

//   return value
//     .toString()
//     .replace(/\s+/g, " ")
//     .trim()
//     .toUpperCase();
// };

// // ======================================================
// // HOD COURSE CLEANER
// //
// // Examples:
// //
// // BCA
// // BCA 1ST YEAR
// // BCA 2ND YEAR
// // BCA 3RD YEAR
// // BCA 4TH YEAR
// //
// //       ↓
// //
// // BCA
// //
// // B.TECH CSE 1ST YEAR
// // B.TECH CSE 2ND YEAR
// //
// //       ↓
// //
// // B.TECH CSE
// // ======================================================
// const cleanCourseForHod = (courseName) => {
//   let course = cleanString(courseName);

//   if (!course) {
//     return "";
//   }

//   // Remove year / semester suffix
//   course = course
//     .replace(
//       /\s*[-_]?\s*(?:1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH)\s*(?:YEAR)?\s*$/i,
//       ""
//     )
//     .replace(
//       /\s*[-_]?\s*(?:YEAR|SEM|SEMESTER)\s*\d+\s*$/i,
//       ""
//     )
//     .replace(/\s+/g, " ")
//     .trim();

//   return course;
// };

// // ======================================================
// // GET ASSIGNMENT PAGE
// // ======================================================
// app.get(
//   "/admin/add/class/incharge",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const [
//       classData,
//       section,
//       teacher,
//       assignedIncharges,
//       assignedHods,
//     ] = await Promise.all([
//       Class.find({}).sort({ class: 1 }).lean(),

//       Section.find({}).sort({ name: 1 }).lean(),

//       Teacher.find({}).sort({ name: 1 }).lean(),

//       ClassIncharge.find({})
//         .populate("teacher", "name department")
//         .sort({ createdAt: -1 })
//         .lean(),

//       Hod.find({})
//         .populate("teacher", "name department")
//         .sort({ courseName: 1 })
//         .lean(),
//     ]);

//     const semesters = ["1", "2", "3", "4", "5", "6", "7", "8"];

//     return res.render("admin/addIncharge", {
//       classData,
//       section,
//       teacher,
//       semesters,
//       assignedIncharges,
//       assignedHods,
//     });
//   })
// );

// // ======================================================
// // SAVE / REPLACE CLASS INCHARGE
// // ======================================================
// app.post(
//   "/admin/save/class-incharge",
//   verifySession,
//   isAdminVerified,
//   validateClassIncharge,
//   WrapAsync(async (req, res) => {
//     const {
//       className,
//       semester,
//       sectionName,
//       teacherId,
//     } = req.body;

//     const cleanClass = cleanString(className);
//     const cleanSem = cleanString(semester);
//     const cleanSec = cleanString(sectionName);

//     // --------------------------------------------------
//     // BASIC VALIDATION
//     // --------------------------------------------------
//     if (!cleanClass || !cleanSem || !cleanSec || !teacherId) {
//       req.flash(
//         "error",
//         "Class, Semester, Section and Teacher are required."
//       );

//       return res.redirect("/admin/add/class/incharge");
//     }

//     // --------------------------------------------------
//     // OBJECT ID CHECK
//     // --------------------------------------------------
//     if (!mongoose.Types.ObjectId.isValid(teacherId)) {
//       req.flash("error", "Invalid Teacher selected.");

//       return res.redirect("/admin/add/class/incharge");
//     }

//     // --------------------------------------------------
//     // FIND TEACHER
//     // --------------------------------------------------
//     const teacherObj = await Teacher.findById(teacherId).lean();

//     if (!teacherObj) {
//       req.flash("error", "Selected teacher does not exist.");

//       return res.redirect("/admin/add/class/incharge");
//     }

//     // --------------------------------------------------
//     // STEP 1
//     //
//     // Check whether THIS TEACHER is already assigned
//     // somewhere else.
//     //
//     // If same slot -> allowed.
//     // If different slot -> reject.
//     // --------------------------------------------------
//     const teacherAssignment = await ClassIncharge.findOne({
//       teacher: teacherObj._id,
//     }).lean();

//     if (teacherAssignment) {
//       const sameSlot =
//         teacherAssignment.className === cleanClass &&
//         teacherAssignment.semester === cleanSem &&
//         teacherAssignment.sectionName === cleanSec;

//       if (!sameSlot) {
//         req.flash(
//           "error",
//           `Teacher "${teacherObj.name}" is already Class Incharge of ${teacherAssignment.className} - Sem ${teacherAssignment.semester} - Section ${teacherAssignment.sectionName}.`
//         );

//         return res.redirect("/admin/add/class/incharge");
//       }
//     }

//     // --------------------------------------------------
//     // STEP 2
//     //
//     // Find current teacher of THIS slot.
//     // --------------------------------------------------
//     const currentSlot = await ClassIncharge.findOne({
//       className: cleanClass,
//       semester: cleanSem,
//       sectionName: cleanSec,
//     }).lean();

//     // --------------------------------------------------
//     // SAME TEACHER + SAME SLOT
//     // Nothing wrong. Update it safely.
//     // --------------------------------------------------
//     if (
//       currentSlot &&
//       currentSlot.teacher.toString() === teacherObj._id.toString()
//     ) {
//       req.flash(
//         "success",
//         `Teacher "${teacherObj.name}" is already assigned to this Class Incharge slot.`
//       );

//       return res.redirect("/admin/add/class/incharge");
//     }

//     // --------------------------------------------------
//     // DIFFERENT TEACHER ALREADY EXISTS
//     //
//     // REPLACE OLD TEACHER
//     // --------------------------------------------------
//     if (currentSlot) {
//       try {
//         await ClassIncharge.updateOne(
//           { _id: currentSlot._id },
//           {
//             $set: {
//               className: cleanClass,
//               semester: cleanSem,
//               sectionName: cleanSec,
//               teacher: teacherObj._id,
//             },
//           },
//           {
//             runValidators: true,
//           }
//         );

//         req.flash(
//           "success",
//           `Class Incharge updated. "${teacherObj.name}" is now Incharge of ${cleanClass} - Sem ${cleanSem} - Section ${cleanSec}.`
//         );

//         return res.redirect("/admin/add/class/incharge");
//       } catch (error) {
//         // ------------------------------------------------
//         // DUPLICATE KEY SAFETY
//         // ------------------------------------------------
//         if (error.code === 11000) {
//           req.flash(
//             "error",
//             "This teacher is already assigned to another Class Incharge."
//           );

//           return res.redirect("/admin/add/class/incharge");
//         }

//         throw error;
//       }
//     }

//     // --------------------------------------------------
//     // NO CURRENT SLOT
//     // CREATE NEW ASSIGNMENT
//     // --------------------------------------------------
//     try {
//       await ClassIncharge.create({
//         className: cleanClass,
//         semester: cleanSem,
//         sectionName: cleanSec,
//         teacher: teacherObj._id,
//       });

//       req.flash(
//         "success",
//         `Class Incharge "${teacherObj.name}" assigned successfully.`
//       );

//       return res.redirect("/admin/add/class/incharge");
//     } catch (error) {
//       if (error.code === 11000) {
//         req.flash(
//           "error",
//           "This teacher is already assigned as a Class Incharge elsewhere."
//         );

//         return res.redirect("/admin/add/class/incharge");
//       }

//       throw error;
//     }
//   })
// );

// // ======================================================
// // SAVE / REPLACE HOD
// // ======================================================
// app.post(
//   "/admin/save/hod",
//   verifySession,
//   isAdminVerified,
//   validateHod,
//   WrapAsync(async (req, res) => {
//     const { courseName, teacherId } = req.body;

//     // --------------------------------------------------
//     // CLEAN COURSE
//     // --------------------------------------------------
//     const cleanedCourse = cleanCourseForHod(courseName);

//     if (!cleanedCourse || !teacherId) {
//       req.flash(
//         "error",
//         "Course/Department and Teacher are required."
//       );

//       return res.redirect("/admin/add/class/incharge");
//     }

//     // --------------------------------------------------
//     // OBJECT ID CHECK
//     // --------------------------------------------------
//     if (!mongoose.Types.ObjectId.isValid(teacherId)) {
//       req.flash("error", "Invalid Teacher selected.");

//       return res.redirect("/admin/add/class/incharge");
//     }

//     // --------------------------------------------------
//     // FIND TEACHER
//     // --------------------------------------------------
//     const teacherObj = await Teacher.findById(teacherId).lean();

//     if (!teacherObj) {
//       req.flash("error", "Selected teacher does not exist.");

//       return res.redirect("/admin/add/class/incharge");
//     }

//     // --------------------------------------------------
//     // STEP 1
//     //
//     // Check if teacher is already HOD somewhere else.
//     //
//     // Same course -> allowed.
//     // Different course -> reject.
//     // --------------------------------------------------
//     const teacherHod = await Hod.findOne({
//       teacher: teacherObj._id,
//     }).lean();

//     if (teacherHod) {
//       const sameCourse =
//         cleanString(teacherHod.courseName) ===
//         cleanString(cleanedCourse);

//       if (!sameCourse) {
//         req.flash(
//           "error",
//           `Teacher "${teacherObj.name}" is already HOD of "${teacherHod.courseName}".`
//         );

//         return res.redirect("/admin/add/class/incharge");
//       }
//     }

//     // --------------------------------------------------
//     // STEP 2
//     //
//     // Find current HOD of this course.
//     // --------------------------------------------------
//     const currentHod = await Hod.findOne({
//       courseName: cleanedCourse,
//     }).lean();

//     // --------------------------------------------------
//     // SAME TEACHER + SAME COURSE
//     // --------------------------------------------------
//     if (
//       currentHod &&
//       currentHod.teacher.toString() === teacherObj._id.toString()
//     ) {
//       req.flash(
//         "success",
//         `Teacher "${teacherObj.name}" is already HOD of "${cleanedCourse}".`
//       );

//       return res.redirect("/admin/add/class/incharge");
//     }

//     // --------------------------------------------------
//     // DIFFERENT TEACHER
//     //
//     // REPLACE OLD HOD
//     // --------------------------------------------------
//     if (currentHod) {
//       try {
//         await Hod.updateOne(
//           { _id: currentHod._id },
//           {
//             $set: {
//               courseName: cleanedCourse,
//               teacher: teacherObj._id,
//             },
//           },
//           {
//             runValidators: true,
//           }
//         );

//         req.flash(
//           "success",
//           `"${cleanedCourse}" HOD successfully changed to "${teacherObj.name}".`
//         );

//         return res.redirect("/admin/add/class/incharge");
//       } catch (error) {
//         if (error.code === 11000) {
//           req.flash(
//             "error",
//             "This teacher is already assigned as HOD of another course."
//           );

//           return res.redirect("/admin/add/class/incharge");
//         }

//         throw error;
//       }
//     }

//     // --------------------------------------------------
//     // NO HOD FOR COURSE
//     //
//     // CREATE NEW
//     // --------------------------------------------------
//     try {
//       await Hod.create({
//         courseName: cleanedCourse,
//         teacher: teacherObj._id,
//       });

//       req.flash(
//         "success",
//         `"${cleanedCourse}" HOD assigned successfully to "${teacherObj.name}".`
//       );

//       return res.redirect("/admin/add/class/incharge");
//     } catch (error) {
//       if (error.code === 11000) {
//         req.flash(
//           "error",
//           "This teacher is already assigned as HOD of another course."
//         );

//         return res.redirect("/admin/add/class/incharge");
//       }

//       throw error;
//     }
//   })
// );

// // ======================================================
// // DELETE CLASS INCHARGE
// // ======================================================
// app.post(
//   "/admin/delete/class-incharge/:id",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       req.flash("error", "Invalid Class Incharge ID.");

//       return res.redirect("/admin/add/class/incharge");
//     }

//     const deleted = await ClassIncharge.findByIdAndDelete(id);

//     if (!deleted) {
//       req.flash("error", "Class Incharge assignment not found.");

//       return res.redirect("/admin/add/class/incharge");
//     }

//     req.flash(
//       "success",
//       "Class Incharge removed successfully."
//     );

//     return res.redirect("/admin/add/class/incharge");
//   })
// );

// // ======================================================
// // DELETE HOD
// // ======================================================
// app.post(
//   "/admin/delete/hod/:id",
//   verifySession,
//   isAdminVerified,
//   WrapAsync(async (req, res) => {
//     const { id } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       req.flash("error", "Invalid HOD ID.");

//       return res.redirect("/admin/add/class/incharge");
//     }

//     const deleted = await Hod.findByIdAndDelete(id);

//     if (!deleted) {
//       req.flash("error", "HOD assignment not found.");

//       return res.redirect("/admin/add/class/incharge");
//     }

//     req.flash(
//       "success",
//       "Department HOD removed successfully."
//     );

//     return res.redirect("/admin/add/class/incharge");
//   })
// );

//--------------------------------------  Marks MANAGEMENT------------------------------------------------

// STORE EXAM DATA BY YEARS

// ==========================================
// 📥 1. GET ROUTE: Render Configuration Form
// ==========================================
app.get(
  "/admin/save/exam/data",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const classData = await Class.find({}).lean();
    const sectionData = await Section.find({}).lean();

    res.render("admin/saveExamData.ejs", {
      classData,
      sectionData,
    });
  }),
);

// ==========================================
// 📤 2. POST ROUTE: Save / Push Exam Configuration
// ==========================================
app.post(
  "/admin/save/exam/data",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const {
      className,
      semester,
      section,
      academicYear,
      examName,
      maxMarks,
      passingMarks,
    } = req.body;

    // 1. Mandatory Input Validation
    if (
      !className ||
      !semester ||
      !section ||
      !academicYear ||
      !examName ||
      !maxMarks ||
      !passingMarks
    ) {
      req.flash("error", "All fields are required!");
      return res.redirect("/admin/save/exam/data");
    }

    const parsedMaxMarks = Number(maxMarks);
    const parsedPassingMarks = Number(passingMarks);
    // const parsedAcademicYear = Number(academicYear);
    const parsedAcademicYear = String(academicYear).trim();
    const parsedSemester = Number(semester);

    if (parsedPassingMarks > parsedMaxMarks) {
      req.flash("error", "Passing Marks cannot be greater than Maximum Marks!");
      return res.redirect("/admin/save/exam/data");
    }

    // 🔠 Standardize Uppercase Values
    const formattedClassName = className.trim().toUpperCase();
    const formattedSection = section.trim().toUpperCase();
    const formattedExamName = examName.trim().toUpperCase();

    // 2. Check if Parent Configuration Group Exists
    let existingConfig = await ExamConfig.findOne({
      className: formattedClassName,
      semester: parsedSemester,
      section: formattedSection,
      academicYear: parsedAcademicYear,
    });

    if (existingConfig) {
      // 🔒 Check if Exam with same UPPERCASE name already exists in array
      const isDuplicateExam = existingConfig.exams.some(
        (ex) => ex.examName.toUpperCase() === formattedExamName,
      );

      if (isDuplicateExam) {
        req.flash(
          "error",
          `Exam '${formattedExamName}' already exists for ${formattedClassName} Sem-${parsedSemester} (${formattedSection})!`,
        );
        return res.redirect("/admin/save/exam/data");
      }

      // ➕ Push New Exam into Existing Document Array
      existingConfig.exams.push({
        examName: formattedExamName,
        maxMarks: parsedMaxMarks,
        passingMarks: parsedPassingMarks,
      });

      await existingConfig.save();
      req.flash("success", `Exam '${formattedExamName}' added successfully!`);
    } else {
      // 🆕 Create Brand New Group Document
      const newExamConfig = new ExamConfig({
        className: formattedClassName,
        semester: parsedSemester,
        section: formattedSection,
        academicYear: parsedAcademicYear,
        exams: [
          {
            examName: formattedExamName,
            maxMarks: parsedMaxMarks,
            passingMarks: parsedPassingMarks,
          },
        ],
      });

      await newExamConfig.save();
      req.flash("success", "New Exam configuration created successfully!");
    }

    return res.redirect("/admin/save/exam/data");
  }),
);

app.get(
  "/admin/show/exam/data",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const examConfigs = await ExamConfig.find({})
      .sort({ createdAt: -1 })
      .lean();

    // Database mein saved unique class names extract kar rahe hain
    const uniqueClasses = [
      ...new Set(examConfigs.map((item) => item.className)),
    ].filter(Boolean);

    res.render("admin/showExamData.ejs", {
      examConfigs,
      uniqueClasses,
    });
  }),
);

// ==========================================
// 🗑️ 4. DELETE SINGLE SUB-EXAM FROM ARRAY (DELETE)
// ==========================================
app.delete(
  "/admin/delete/exam/sub/:parentId/:examId",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { parentId, examId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(parentId) ||
      !mongoose.Types.ObjectId.isValid(examId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format provided!",
      });
    }

    // $pull removes specific object from sub-document array
    const updatedConfig = await ExamConfig.findByIdAndUpdate(
      parentId,
      { $pull: { exams: { _id: examId } } },
      { new: true },
    );

    if (!updatedConfig) {
      return res.status(404).json({
        success: false,
        message: "Configuration record not found!",
      });
    }

    // If array becomes completely empty after deleting exam, clean up main parent doc
    let isParentDeleted = false;
    if (updatedConfig.exams.length === 0) {
      await ExamConfig.findByIdAndDelete(parentId);
      isParentDeleted = true;
    }

    return res.status(200).json({
      success: true,
      message: "Exam removed successfully!",
      isParentDeleted,
    });
  }),
);

// ==========================================
// 🗑️ 5. DELETE ENTIRE CLASS GROUP (DELETE)
// ==========================================
app.delete(
  "/admin/delete/exam/parent/:parentId",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { parentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(parentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Configuration ID format!",
      });
    }

    const deletedConfig = await ExamConfig.findByIdAndDelete(parentId);

    if (!deletedConfig) {
      return res.status(404).json({
        success: false,
        message: "Configuration group not found!",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Whole configuration group deleted successfully!",
    });
  }),
);

// 1. RENDER MAIN PAGE
app.get(
  "/admin/marks-management",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const classes = await Marks.distinct("className");
    res.render("admin/marksManagement.ejs", { classes });
  }),
);

// API 1: Get Semesters
app.get(
  "/api/marks/semesters",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className } = req.query;
    if (!className) return res.json([]);
    const semesters = await Marks.distinct("semester", { className });
    res.json(semesters.filter(Boolean).sort((a, b) => a - b));
  }),
);

// API 2: Get Academic Years
app.get(
  "/api/marks/academic-years",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className, semester } = req.query;
    const semNum = parseInt(semester, 10);
    if (!className || isNaN(semNum)) return res.json([]);

    const academicYears = await Marks.distinct("academicYear", {
      className,
      semester: semNum,
    });
    res.json(academicYears.filter(Boolean).sort((a, b) => b.localeCompare(a)));
  }),
);

// API 3: Get Exam Names
app.get(
  "/api/marks/exams",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className, semester, academicYear } = req.query;
    const semNum = parseInt(semester, 10);
    // const yearNum = parseInt(academicYear, 10);
    const academicYearStr = academicYear ? String(academicYear).trim() : "";
    if (!className || isNaN(semNum) || !academicYearStr) return res.json([]);

    const exams = await Marks.distinct("examName", {
      className,
      semester: semNum,
      academicYear: academicYearStr,
    });
    res.json(exams.filter(Boolean));
  }),
);

// API 4: Fetch Pivoted Matrix Records
app.get(
  "/api/marks/records",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className, semester, academicYear, examName } = req.query;

    const semNum = parseInt(semester, 10);
    // const yearNum = parseInt(academicYear, 10);
    const academicYearStr = academicYear ? String(academicYear).trim() : "";

    if (!className || isNaN(semNum) || !academicYearStr || !examName) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid or missing filter parameters.",
        });
    }

    const records = await Marks.find({
      className: String(className).trim(),
      semester: semNum,
      academicYear: academicYearStr,
      examName: String(examName).trim().toUpperCase(),
    }).lean();

    res.json({ success: true, records });
  }),
);

// API 5: Lock / Unlock Section Toggle
app.post(
  "/api/marks/toggle-lock",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const {
      className,
      semester,
      academicYear,
      examName,
      section,
      targetStatus,
    } = req.body;

    const semNum = parseInt(semester, 10);
    // const yearNum = parseInt(academicYear, 10);
    const academicYearStr = academicYear ? String(academicYear).trim() : "";

    if (!["OPEN", "LOCKED"].includes(targetStatus)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status value." });
    }

    await Marks.updateMany(
      {
        className: String(className).trim(),
        semester: semNum,
        academicYear: academicYearStr,
        examName: String(examName).trim().toUpperCase(),
        section: String(section).trim(),
      },
      { $set: { status: targetStatus } },
    );

    res.json({
      success: true,
      message: `Section ${section} status updated to ${targetStatus}`,
    });
  }),
);

// API 6: Delete Entire Section
app.delete(
  "/api/marks/delete-section",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { className, semester, academicYear, examName, section } = req.body;

    const semNum = parseInt(semester, 10);
    // const yearNum = parseInt(academicYear, 10);
    const academicYearStr = academicYear ? String(academicYear).trim() : "";

    const result = await Marks.deleteMany({
      className: String(className).trim(),
      semester: semNum,
      academicYear: academicYearStr,
      examName: String(examName).trim().toUpperCase(),
      section: String(section).trim(),
    });

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} registers for Section ${section}`,
    });
  }),
);

// API 7: Edit Single Student Mark
app.post(
  "/api/marks/edit-student-mark",
 verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { registerId, studentId, obtainedMarks, attendanceStatus, remarks } =
      req.body;

    if (!mongoose.Types.ObjectId.isValid(registerId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Register ID." });
    }

    const markSheet = await Marks.findById(registerId);
    if (!markSheet)
      return res
        .status(404)
        .json({ success: false, message: "Register not found." });

    if (markSheet.status === "LOCKED") {
      return res
        .status(403)
        .json({ success: false, message: "Cannot edit. Section is LOCKED." });
    }

    // Safe Student Finder without Crash on undefined ObjectIDs
    const studentObj = markSheet.students.find((s) => {
      const sId = s.studentId ? s.studentId.toString() : null;
      const subId = s._id ? s._id.toString() : null;
      return (sId && sId === studentId) || (subId && subId === studentId);
    });

    if (!studentObj) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Student record not found in register.",
        });
    }

    // Strict Server-side Rules Validation
    const finalAttendance =
      attendanceStatus === "Absent" ? "Absent" : "Present";
    const finalMarks = finalAttendance === "Absent" ? 0 : Number(obtainedMarks);

    if (isNaN(finalMarks) || finalMarks < 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid obtained marks value." });
    }

    if (finalMarks > markSheet.maxMarks) {
      return res.status(400).json({
        success: false,
        message: `Marks (${finalMarks}) exceed Maximum Allowed Marks (${markSheet.maxMarks})`,
      });
    }

    studentObj.attendanceStatus = finalAttendance;
    studentObj.obtainedMarks = finalMarks;
    studentObj.remarks = String(remarks || "").substring(0, 150); // Mongoose Schema Limit Safety
    studentObj.updatedAt = new Date();

    await markSheet.save();
    res.json({ success: true, message: "Student marks updated successfully!" });
  }),
);

// API 8: Delete Single Subject Register
app.delete(
  "/api/marks/delete-subject/:id",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Register ID." });
    }

    await Marks.findByIdAndDelete(id);
    res.json({
      success: true,
      message: "Subject register deleted successfully.",
    });
  }),
);

// Archive Student Record

app.get(
  "/archive/student/record",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let classData = await Class.find({});
    res.render("admin/studentArchive.ejs", { classData });
  }),
);

app.post(
  "/archive/student/record",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { currentClass, currentSemester } = req.body.data;
    const { adminPassword } = req.body;

    // 1. Inputs Validation Check
    if (!currentClass || !currentSemester || !adminPassword) {
      req.flash("error", "All fields including password are required!");
      return res.redirect("/archive/student/record");
    }

    // 2. 🔐 Password Verification
    const IsValidPassword = adminPassword === process.env.Admin_Secret_Password;
    if (!IsValidPassword) {
      req.flash("error", "Security alert: Incorrect Admin Password!");
      return res.redirect("/archive/student/record");
    }

    // ==========================================
    // 🔥 TRANSACTION SESSION START
    // ==========================================
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 3. Batch ke students find karo session ke andar
      const targetStudents = await Student.find({
        class: currentClass,
        semester: currentSemester,
      }).session(session);

      if (targetStudents.length === 0) {
        req.flash("error", "No students found in the selected batch!");
        await session.abortTransaction();
        session.endSession();
        return res.redirect("/archive/student/record");
      }

      const studentIds = targetStudents.map((s) => s._id);

      // 4. Live attendance data nikal lo
      const liveAttendances = await Attendance.find({
        studentId: { $in: studentIds },
      }).session(session);

      // 5. Attendance pipeline format map karo
      const attendanceArchiveData = liveAttendances.map((att) => ({
        originalAttendanceId: att._id,
        studentId: att.studentId,
        date: att.date,
        status: att.status,
        period: att.period,
        subject: att.subject,
        unit: att.unit,
        description: att.description,
        class: att.class,
        teacherName: att.teacherName,
        teacherId: att.teacherId,
      }));

      // 6. Student profile format map karo
      const studentArchiveData = targetStudents.map((student) => {
        // Agar student.class = "BCA 3rd Year" hai, toh split(" ")[0] se sirf "BCA" milega
        let cleanClass = student.class
          ? student.class.trim().split(" ")[0]
          : "N/A";

        return {
          originalStudentId: student._id,
          rollNo: student.rollNo,
          name: student.name,
          fatherName: student.fatherName,
          class: cleanClass, // 🔥 Ab hamesha clean naam save hoga (BCA, BBA, BTech)
          session: student.session, // 📅 Session filter ke liye sabse compulsory hai (e.g., 2022-2025)
          semester: student.semester, // Ise schema me pada rehne do, par search me tension nahi lega
          section: student.section,
          email: student.email,
          image:
            student.image && student.image.url
              ? { url: student.image.url, filename: student.image.filename }
              : undefined,
          status: "passout",
        };
      });

      // 7. Archive independent tables me dump karo
      if (attendanceArchiveData.length > 0) {
        await AttendanceArchive.insertMany(attendanceArchiveData, { session });
      }
      await StudentArchive.insertMany(studentArchiveData, { session });

      // 8. Live tables clear out karo safely
      // await Attendance.deleteMany({ studentId: { $in: studentIds } }).session(session);
      await Student.deleteMany({ _id: { $in: studentIds } }).session(session);

      // ==========================================
      // 🎉 COMMIT TRANSACTION (SUCCESS STATE)
      // ==========================================
      await session.commitTransaction();
      session.endSession();

      req.flash(
        "success",
        `Successfully archived and deleted ${targetStudents.length} students along with logs.`,
      );
      res.redirect("/archive/student/record");
    } catch (error) {
      // ==========================================
      // 🚨 ROLLBACK TRANSACTION (ERROR STATE)
      // ==========================================
      await session.abortTransaction();
      session.endSession();

      console.error(
        "🔥 Error caught in /archive/student/record, database rolled back:",
        error,
      );
      req.flash(
        "error",
        "Migration failed due to internal fetch error! Data is completely safe.",
      );
      res.redirect("/archive/student/record");
    }
  }),
);

//    show/student/archive/record

app.get(
  "/show/archive/student/record",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const limit = 40;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    // Form inputs parameter mapping
    const searchName = req.query.name ? req.query.name.trim() : "";
    const searchClass = req.query.class ? req.query.class.trim() : "";
    const searchSession = req.query.session ? req.query.session.trim() : "";

    let filterCondition = {};

    // 🔍 1. Name Match
    if (searchName) {
      filterCondition.name = { $regex: searchName, $options: "i" };
    }
    // 🏢 2. Clean Core Class Match
    if (searchClass) {
      filterCondition.class = searchClass;
    }
    // 📅 3. Session Match
    if (searchSession) {
      filterCondition.session = searchSession;
    }

    // 📊 Dynamic Live Counts & Pagination Check
    const totalRecords = await StudentArchive.countDocuments(filterCondition);
    const totalPages = Math.ceil(totalRecords / limit);

    // Dynamic clean queries execution
    const [datas, uniqueClasses, uniqueSessions] = await Promise.all([
      StudentArchive.find(filterCondition)
        .sort({ archivedAt: -1 })
        .skip(skip)
        .limit(limit),
      StudentArchive.distinct("class"), // 🔥 Auto-detect classes from Archive
      StudentArchive.distinct("session"), // Auto-detect sessions from Archive
    ]);

    res.render("admin/showStudentArchive.ejs", {
      datas,
      uniqueClasses, // EJS dropdown ko pass kiya
      uniqueSessions,
      currentPage: page,
      totalPages,
      totalRecords,
      searchName,
      searchClass,
      searchSession,
    });
  }),
);

//      Archive student Status  /

// 🏠 1. PAGE RENDER ROUTE: Jab table ke "View Logs" par click hoga
app.get(
  "/archive/student/status/:rollNo",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { rollNo } = req.params;

    if (!rollNo) {
      req.flash("error", "Roll number is missing");
      return res.redirect("/show/archive/student/record");
    }

    // Student profile ko Archive collection se dhoondo
    const student = await StudentArchive.findOne({ rollNo: parseInt(rollNo) });

    if (!student) {
      req.flash("error", "Archived Student profile not found");
      return res.redirect("/show/archive/student/record");
    }

    // "admin/studentArchiveStatus.ejs" template ko call karo aur bache ka data bhej do
    res.render("admin/studentArchiveStatus.ejs", { student });
  }),
);

// 📊 2. AJAX DATA FILTER API: Jo page ke andar se dynamic fetch call chalayega
// 📊 AJAX DATA FILTER API (Fixed according to MongoDB Schema)
app.get(
  "/archive/attendance/:originalStudentId/filter",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { originalStudentId } = req.params;
    const { startDate, endDate, year } = req.query;
    const targetYear = parseInt(year);

    // 🔥 FIX 1: Database screenshot ke mutabik field ka naam 'studentId' hai
    let queryCondition = { studentId: originalStudentId };

    // 🔍 Date Range Check
    if (startDate && endDate) {
      queryCondition.date = {
        $gte: new Date(startDate + "T00:00:00.000Z"),
        $lte: new Date(endDate + "T23:59:59.999Z"),
      };
    }

    // 🏢 FIX 2: Kyunki schema mein 'semester' nahi hai, hum 'class' field ke string se match karenge
    if (targetYear) {
      let yearString = "";
      if (targetYear === 1) yearString = "1ST YEAR";
      else if (targetYear === 2) yearString = "2ND YEAR";
      else if (targetYear === 3) yearString = "3RD YEAR";
      else if (targetYear === 4) yearString = "4TH YEAR";

      // Regex use karenge taaki agar "BCA 3RD YEAR" ya "BBA 3RD YEAR" kuch bhi ho, woh match ho jaye
      queryCondition.class = { $regex: yearString, $options: "i" };
    }

    // Database query execution
    const attendanceLogs = await AttendanceArchive.find(queryCondition).sort({
      date: -1,
    });

    // Analytics Counter Logic
    const totalLectures = attendanceLogs.length;
    const presentCount = attendanceLogs.filter(
      (log) => log.status?.toLowerCase() === "present",
    ).length;
    const absentCount = totalLectures - presentCount;
    const percentage =
      totalLectures > 0 ? ((presentCount / totalLectures) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      analytics: {
        totalLectures,
        presentCount,
        absentCount,
        percentage: `${percentage}%`,
      },
      data: attendanceLogs,
    });
  }),
);


// ---------------------------------------Account Section---------------------------------------------------

// ==========================================
// HELPER FOR SAFE CURRENCY ROUNDING
// ==========================================
const round2 = (num) =>
  Math.round(((parseFloat(num) || 0) + Number.EPSILON) * 100) / 100;

// ==========================================
// 1. API: EDIT VALIDATION CHECK (AJAX Endpoint)
// ==========================================

app.get(
  "/api/check-fee-structure-exists",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { section, baseCourse, batchSession, yearTag } = req.query;

    const escapeRegex = (text) =>
      text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");

    // 1. Session Clean & Regex
    const rawSession = (batchSession || "").replace(/\s+/g, " ").trim();
    if (!rawSession) {
      return res.status(400).json({
        exists: false,
        message: "⚠️ Batch/Session parameter required hai!",
      });
    }

    const safeSession = escapeRegex(rawSession).replace(
      /\\\s*-\\s*/g,
      "\\s*-\\s*",
    );
    const sessionRegex = new RegExp(`^${safeSession}$`, "i");

    // 2. Semester Calculation Logic
    let semA = null;
    let semB = null;

    if (yearTag) {
      const yearMatch = String(yearTag).match(/(\d+)/);
      if (yearMatch) {
        const yearNum = parseInt(yearMatch[1], 10);
        semB = yearNum * 2;
        semA = semB - 1;
      }
    }

    if (!semA || !semB) {
      return res.status(400).json({
        exists: false,
        message: "⚠️ Invalid or missing semester/yearTag parameter!",
      });
    }

    // 3. Class Name & Section Clean
    const queryClassName = (baseCourse || "").replace(/\s+/g, " ").trim();
    const querySection = (section || "").replace(/\s+/g, " ").trim();

    if (!queryClassName) {
      return res.status(400).json({
        exists: false,
        message: "⚠️ Full Course/Class name required hai!",
      });
    }

    const classRegex = new RegExp(`^${escapeRegex(queryClassName)}$`, "i");
    const sectionRegex = new RegExp(`^${escapeRegex(querySection)}$`, "i");

    // 4. Strict DB Query
    const existingLedgerCount = await FeeLedger.countDocuments({
      session: sessionRegex,
      classesHistory: {
        $elemMatch: {
          className: classRegex,
          ...(querySection ? { section: sectionRegex } : {}),
        },
      },
      "semesters.semNumber": { $all: [semA, semB] },
    });

    if (existingLedgerCount > 0) {
      return res.json({
        exists: true,
        semA,
        semB,
        batchSession: rawSession,
      });
    } else {
      return res.json({
        exists: false,
        message: `🚨 Structure Not Defined: Selected batch (${queryClassName}${querySection ? " - Sec " + querySection : ""}, Session: ${rawSession}) does NOT have fee structure initialized for Semester ${semA} & ${semB}!`,
      });
    }
  }),
);

// STUDENT KA    FEES  STRUCTURE ADD  KARO    ( GET  ROUTE)

app.get(
  "/add/student/fees",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const [classData, sectionData] = await Promise.all([
      Class.find({}).lean(),
      Section.find({}).lean(),
    ]);

    const currentYear = new Date().getFullYear();
    let {
      section,
      baseCourse,
      className,
      batchSession,
      semester,
      yearTag,
      mode,
    } = req.query;

    const safeClean = (val) =>
      val ? decodeURIComponent(String(val)).trim() : "";
    const escapeRegex = (text) =>
      text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");

    const targetClass = safeClean(className || baseCourse);
    const targetSection = safeClean(section);
    const rawSession = safeClean(batchSession);
    const cleanYearTag = safeClean(yearTag).toUpperCase();

    // Safe floating precision rounding
    const round2 = (num) => {
      const val = Number(num);
      return isNaN(val) ? 0 : Math.round((val + Number.EPSILON) * 100) / 100;
    };

    // 1. Determine active semesters
    let activeSemesters = [];
    if (cleanYearTag) {
      const yearMatch = cleanYearTag.match(/(\d+)/);
      if (yearMatch) {
        const yearNum = parseInt(yearMatch[1], 10);
        const semB = yearNum * 2;
        activeSemesters = [semB - 1, semB];
      }
    }

    if (activeSemesters.length === 0 && semester) {
      const semNum = parseInt(semester, 10);
      if (!isNaN(semNum) && semNum > 0) {
        const pairGroup = Math.ceil(semNum / 2);
        activeSemesters = [pairGroup * 2 - 1, pairGroup * 2];
      }
    }

    let students = [];
    let isStructureDefined = true;
    const selectedSem =
      semester || (activeSemesters.length > 0 ? activeSemesters[0] : null);

    if (targetClass && targetSection) {
      const targetSemA =
        activeSemesters[0] || (selectedSem ? parseInt(selectedSem, 10) : 1);
      const targetSemB = activeSemesters[1] || targetSemA + 1;

      // ==========================================
      // ⚡ CASE 1: EDIT MODE
      // ==========================================
      if (mode === "edit") {
        const classRegex = new RegExp(`^${escapeRegex(targetClass)}$`, "i");
        const sectionRegex = new RegExp(`^${escapeRegex(targetSection)}$`, "i");

        let ledgerQuery = {
          "semesters.semNumber": { $all: [targetSemA, targetSemB] },
          classesHistory: {
            $elemMatch: {
              className: classRegex,
              section: sectionRegex,
            },
          },
        };

        if (rawSession) {
          const sessionPattern = rawSession.replace(/\s*-\s*/g, "\\s*-\\s*");
          ledgerQuery.session = new RegExp(`^${sessionPattern}$`, "i");
        }

        const existingLedgers = await FeeLedger.find(ledgerQuery).lean();

        if (!existingLedgers || existingLedgers.length === 0) {
          isStructureDefined = false;
          req.flash(
            "error",
            `⚠️ Fee structure for Semester ${targetSemA} & ${targetSemB} is not initialized yet! Please create a new entry first.`,
          );
        } else {
          students = existingLedgers.map((ledger) => {
            const semAData = ledger.semesters?.find(
              (s) => Number(s.semNumber) === targetSemA,
            );
            const semBData = ledger.semesters?.find(
              (s) => Number(s.semNumber) === targetSemB,
            );

            const semADue = semAData ? semAData.due_amount || 0 : 0;
            const semBDue = semBData ? semBData.due_amount || 0 : 0;
            const hasPaidInTargetSems =
              semAData?.amount_paid > 0 || semBData?.amount_paid > 0;

            return {
              _id: ledger.student_id,
              rollNo: ledger.rollNumber,
              name: ledger.studentName,
              fatherName: ledger.fatherName || "N/A",
              class: targetClass,
              section: targetSection,
              session: ledger.session,
              total_course_fees: round2(ledger.total_course_fees || 0),
              semADue: round2(semADue),
              semBDue: round2(semBDue),
              existingYearTotal: round2(semADue + semBDue),
              hasPaidInTargetSems,
            };
          });
        }
      }
      // ==========================================
      // ⚡ CASE 2: NEW STRUCTURE (CREATE MODE)
      // ==========================================

      // else {
      //       let studentQuery = {
      //         class: new RegExp(`^${escapeRegex(targetClass)}$`, "i"),
      //         section: new RegExp(`^${escapeRegex(targetSection)}$`, "i")
      //       };

      //       if (selectedSem) {
      //         studentQuery.semester = String(selectedSem);
      //       }

      //       if (rawSession) {
      //         const sessionPattern = rawSession.replace(/\s*-\s*/g, "\\s*-\\s*");
      //         studentQuery.session = new RegExp(`^${sessionPattern}$`, "i");
      //       }

      //       const studentsRaw = await Student.find(studentQuery)
      //         .select("_id rollNo name fatherName class semester section session")
      //         .lean();

      //       if (studentsRaw.length > 0) {
      //         const studentIds = studentsRaw.map(s => s._id);

      //         const existingLedgers = await FeeLedger.find({
      //           student_id: { $in: studentIds }
      //         })
      //         .select("student_id total_course_fees total_amount_paid semesters")
      //         .lean();

      //         const ledgerMap = new Map(existingLedgers.map(l => [l.student_id.toString(), l]));

      //         students = studentsRaw.map(student => {
      //           const ledger = ledgerMap.get(student._id.toString());
      //           let semADue = 0;
      //           let semBDue = 0;
      //           let totalCourseFees = 0;
      //           let hasPaidInTargetSems = false;

      //           if (ledger) {
      //             totalCourseFees = ledger.total_course_fees || 0;
      //             const semAData = ledger.semesters?.find(s => Number(s.semNumber) === targetSemA);
      //             const semBData = ledger.semesters?.find(s => Number(s.semNumber) === targetSemB);

      //             // 1. Agar selected semester pair (jaise 3 & 4) ki record pehle se majood hai
      //             if (semAData || semBData) {
      //               semADue = semAData ? (semAData.due_amount || 0) : 0;
      //               semBDue = semBData ? (semBData.due_amount || 0) : 0;

      //               if ((semAData && semAData.amount_paid > 0) || (semBData && semBData.amount_paid > 0)) {
      //                 hasPaidInTargetSems = true;
      //               }
      //             }
      //             // 2. Agar current year/sem ki entry nai hai, toh previous sem ki exact due_amount uthayega
      //             else if (ledger.semesters && ledger.semesters.length > 0) {
      //               // Chhote semesters filter karo
      //               const prevSems = ledger.semesters
      //                 .filter(s => Number(s.semNumber) < targetSemA)
      //                 .sort((a, b) => Number(a.semNumber) - Number(b.semNumber)); // Ascending order (1, 2, 3...)

      //               if (prevSems.length >= 2) {
      //                 // Last Year ke do sem (jaise 1 aur 2) ki exact due_amount
      //                 semADue = prevSems[prevSems.length - 2].due_amount || 0;
      //                 semBDue = prevSems[prevSems.length - 1].due_amount || 0;
      //               } else if (prevSems.length === 1) {
      //                 semADue = prevSems[0].due_amount || 0;
      //                 semBDue = prevSems[0].due_amount || 0;
      //               }
      //             }
      //           }

      //           return {
      //             ...student,
      //             total_course_fees: round2(totalCourseFees),
      //             semADue: round2(semADue),
      //             semBDue: round2(semBDue),
      //             existingYearTotal: round2(semADue + semBDue),
      //             hasPaidInTargetSems
      //           };
      //         });
      //       }
      //     }
      //   }
      else {
        let studentQuery = {
          class: new RegExp(`^${escapeRegex(targetClass)}$`, "i"),
          section: new RegExp(`^${escapeRegex(targetSection)}$`, "i"),
        };

        if (selectedSem) {
          studentQuery.semester = String(selectedSem);
        }

        if (rawSession) {
          const sessionPattern = rawSession.replace(/\s*-\s*/g, "\\s*-\\s*");
          studentQuery.session = new RegExp(`^${sessionPattern}$`, "i");
        }

        const studentsRaw = await Student.find(studentQuery)
          .select("_id rollNo name fatherName class semester section session")
          .lean();

        if (studentsRaw.length > 0) {
          const studentIds = studentsRaw.map((s) => s._id);

          const existingLedgers = await FeeLedger.find({
            student_id: { $in: studentIds },
          })
            .select("student_id total_course_fees total_amount_paid semesters")
            .lean();

          const ledgerMap = new Map(
            existingLedgers.map((l) => [l.student_id.toString(), l]),
          );

          students = studentsRaw.map((student) => {
            const ledger = ledgerMap.get(student._id.toString());
            let semADue = 0;
            let semBDue = 0;
            let totalCourseFees = 0;
            let hasPaidInTargetSems = false;

            if (ledger) {
              totalCourseFees = ledger.total_course_fees || 0;
              const semAData = ledger.semesters?.find(
                (s) => Number(s.semNumber) === targetSemA,
              );
              const semBData = ledger.semesters?.find(
                (s) => Number(s.semNumber) === targetSemB,
              );

              // 1. Agar Current Target Semesters (jaise Sem 3 & 4) pehle se majood hain
              if (semAData || semBData) {
                semADue = semAData ? semAData.due_amount || 0 : 0;
                semBDue = semBData ? semBData.due_amount || 0 : 0;

                if (
                  (semAData && semAData.amount_paid > 0) ||
                  (semBData && semBData.amount_paid > 0)
                ) {
                  hasPaidInTargetSems = true;
                }
              }
              // 2. Agar current sem ki entry nahi hai -> Previous ya Next available sem se Autofill karein
              else if (ledger.semesters && ledger.semesters.length > 0) {
                const allSems = ledger.semesters;

                // Previous semesters (Target se chhote)
                const prevSems = allSems.filter(
                  (s) => Number(s.semNumber) < targetSemA,
                );

                // Next semesters (Target se bade)
                const nextSems = allSems.filter(
                  (s) => Number(s.semNumber) > targetSemB,
                );

                // Preference: Pehle Previous dekhega, agar pichhla koi record nahi milta toh Next me dekhega
                const isUsingPrev = prevSems.length > 0;
                const refSems = isUsingPrev ? prevSems : nextSems;

                if (refSems.length > 0) {
                  // Odd Semester lookup (Sem A ke liye)
                  const oddSem = refSems
                    .filter((s) => Number(s.semNumber) % 2 !== 0)
                    .sort((a, b) =>
                      isUsingPrev
                        ? Number(b.semNumber) - Number(a.semNumber)
                        : Number(a.semNumber) - Number(b.semNumber),
                    )[0];

                  // Even Semester lookup (Sem B ke liye)
                  const evenSem = refSems
                    .filter((s) => Number(s.semNumber) % 2 === 0)
                    .sort((a, b) =>
                      isUsingPrev
                        ? Number(b.semNumber) - Number(a.semNumber)
                        : Number(a.semNumber) - Number(b.semNumber),
                    )[0];

                  // Safe Autofill Assign
                  semADue = oddSem
                    ? oddSem.due_amount || 0
                    : evenSem
                      ? evenSem.due_amount || 0
                      : refSems[0].due_amount || 0;

                  semBDue = evenSem ? evenSem.due_amount || 0 : semADue;
                }
              }
            }

            return {
              ...student,
              total_course_fees: round2(totalCourseFees),
              semADue: round2(semADue),
              semBDue: round2(semBDue),
              existingYearTotal: round2(semADue + semBDue),
              hasPaidInTargetSems,
            };
          });
        }
      }
    }

    res.render("admin/addFeesData", {
      classData,
      sectionData,
      currentYear,
      students,
      selectedSem,
      activeSemesters,
      isEditMode: mode === "edit",
      isStructureDefined,
      query: {
        ...req.query,
        className: targetClass,
        baseCourse: targetClass,
        section: targetSection,
        batchSession: rawSession,
      },
    });
  }),
);

// 🎯 Helper: Isse Future me kisi bhi tarah ki class string se Pure Course+Branch nikal jayegi
function extractPureCourse(fullClassName) {
  if (!fullClassName) return "";

  return (
    fullClassName
      .toString()
      .trim()
      .toUpperCase()
      // Sabhi possible year formats ko remove karega (e.g., "1ST YEAR", "4TH YEAR", "1 YEAR", "PART-1", "FINAL YEAR")
      .replace(/\b(\d+(ST|ND|RD|TH)?\s*YEAR|PART\s*\d+|FINAL\s*YEAR)\b/gi, "")
      // Double/triple spaces ko clean single space karega
      .replace(/\s+/g, " ")
      .trim()
  );
}

// ==========================================
// 3. POST ROUTE: Save & Edit Bulk Ledger Logic (Unchanged Save Architecture)
// ==========================================

// STUDENT KA    FEES  STRUCTURE ADD  KARO    ( POST  ROUTE)

app.post(
  "/fees/save-bulk-ledger",
  verifySession, isAdminVerified,
  validateFeeData,
  WrapAsync(async (req, res) => {
    const { fees, semA, semB, className, section, isEditMode } = req.body;
    const sA = parseInt(semA);
    const sB = semB ? parseInt(semB) : null;

    if (
      !className ||
      !section ||
      isNaN(sA) ||
      !fees ||
      !Array.isArray(fees) ||
      fees.length === 0
    ) {
      req.flash(
        "error",
        "⚠️ Security Error: Crucial input parameters are missing or invalid!",
      );
      return res.redirect("/add/student/fees");
    }

    const cleanClass = className.trim();
    const cleanSection = section.trim();
    const currentCourseType = extractPureCourse(cleanClass);

    const dbSession = await mongoose.startSession();

    try {
      dbSession.startTransaction();

      const uniqueSubmittedIds = new Set(
        fees.map((f) => f.student_id?.toString()).filter(Boolean),
      );
      const studentObjectIds = Array.from(uniqueSubmittedIds).map(
        (id) => new mongoose.Types.ObjectId(id),
      );

      // Fetch actual database session for strict consistency
      const rawStudentList = await Student.find({
        _id: { $in: studentObjectIds },
      })
        .select("_id session")
        .lean();

      const studentSessionMap = new Map(
        rawStudentList.map((s) => [s._id.toString(), s.session]),
      );

      const sampleRecord =
        fees.find((f) => f.status !== "Left College") || fees[0];
      const rawSampleSession =
        sampleRecord?.session ||
        studentSessionMap.get(sampleRecord?.student_id?.toString()) ||
        "";

      // ⚡ FIX 1: Clean & Standardize Session Format (Remove spaces around hyphens)
      const cleanSessionString = (rawSession) => {
        return (rawSession || "").replace(/\s*-\s*/g, "-").trim();
      };

      const sampleSession = cleanSessionString(rawSampleSession);
      const parsedStartYear = parseInt((sampleSession || "").split("-")[0]);
      const startYear = !isNaN(parsedStartYear)
        ? parsedStartYear
        : new Date().getFullYear();
      const calculatedYearNum = startYear + Math.floor((sA - 1) / 2);

      // Dynamic duplicate check (Only for new batch creation)
      if (isEditMode !== "true") {
        const globalBatchExists = await FeeLedger.findOne({
          classesHistory: {
            $elemMatch: {
              className: cleanClass,
              section: cleanSection,
              academicYear: calculatedYearNum,
            },
          },
        }).session(dbSession);

        if (globalBatchExists) {
          await dbSession.abortTransaction();
          req.flash(
            "error",
            `🚨 DUPLICATE BATCH BLOCKED: Data for "${cleanClass} - Sec ${cleanSection}" for Year (${calculatedYearNum}) ALREADY EXISTS in database!`,
          );
          return res.redirect(
            `/add/student/fees?className=${encodeURIComponent(className)}&semester=${sA}&section=${encodeURIComponent(section)}`,
          );
        }
      }

      const existingLedgers = await FeeLedger.find({
        student_id: { $in: studentObjectIds },
      }).session(dbSession);

      if (isEditMode !== "true") {
        for (let ledger of existingLedgers) {
          const semDuplicate = (ledger.semesters || []).some(
            (s) => s.semNumber === sA || (sB && s.semNumber === sB),
          );

          if (semDuplicate) {
            await dbSession.abortTransaction();
            req.flash(
              "error",
              `⚠️ Semester Conflict: Semester (${sA}${sB ? " or " + sB : ""}) already exists for student ${ledger.studentName}!`,
            );
            return res.redirect(
              `/add/student/fees?className=${encodeURIComponent(className)}&semester=${sA}&section=${encodeURIComponent(section)}`,
            );
          }
        }
      }

      const ledgerMap = new Map(
        existingLedgers.map((l) => [l.student_id.toString(), l]),
      );
      const bulkOperations = [];

      for (let record of fees) {
        if (record.status === "Left College") continue;

        if (
          !record.student_id ||
          !record.rollNumber ||
          !record.studentName ||
          record.due_amount_A === undefined
        ) {
          throw new Error(
            `Grid data error for Admin No: ${record.rollNumber || "Unknown"}`,
          );
        }

        const dueA = round2(Math.max(0, parseFloat(record.due_amount_A) || 0));
        const dueB = sB
          ? round2(Math.max(0, parseFloat(record.due_amount_B) || 0))
          : null;
        let ledger = ledgerMap.get(record.student_id.toString());

        // Extract clean session from Student object map
        const dbStudentSession = studentSessionMap.get(
          record.student_id.toString(),
        );
        const studentSession = cleanSessionString(
          dbStudentSession || record.session || sampleSession,
        );
        const indParsedYear = parseInt((studentSession || "").split("-")[0]);
        const individualStartYear = !isNaN(indParsedYear)
          ? indParsedYear
          : startYear;
        const individualYearNum =
          individualStartYear + Math.floor((sA - 1) / 2);

        if (!ledger) {
          // ==========================================
          // 1. NEW LEDGER CREATION
          // ==========================================
          const initialTotal = round2(dueA + (dueB || 0));
          const initialSemesters = [
            {
              semNumber: sA,
              due_amount: dueA,
              penalty_amount: 0,
              amount_paid: 0,
              balance_pending: dueA,
            },
          ];

          if (sB !== null) {
            initialSemesters.push({
              semNumber: sB,
              due_amount: dueB,
              penalty_amount: 0,
              amount_paid: 0,
              balance_pending: dueB,
            });
          }

          const newLedgerDoc = {
            student_id: new mongoose.Types.ObjectId(
              record.student_id.toString(),
            ),
            rollNumber: record.rollNumber,
            studentName: record.studentName,
            fatherName: record.fatherName || "N/A",
            session: studentSession,
            currentCourse: currentCourseType,
            status: "Active",
            classesHistory: [
              {
                className: cleanClass,
                section: cleanSection,
                academicYear: individualYearNum,
              },
            ],
            semesters: initialSemesters,
            advance_balance: 0,
            total_course_fees: initialTotal,
            total_amount_paid: 0,
            overall_pending_balance: initialTotal,
          };

          bulkOperations.push({ insertOne: { document: newLedgerDoc } });
        } else {
          // ==========================================
          // 2. EDIT / UPDATE RECALCULATION ENGINE
          // ==========================================
          let targetSemesters = [...(ledger.semesters || [])];

          // CHECK POINT: Check if semester previously existed for this specific student
          const hadSemAPreviously = targetSemesters.some(
            (s) => s.semNumber === sA,
          );
          const hadSemBPreviously =
            sB !== null
              ? targetSemesters.some((s) => s.semNumber === sB)
              : true;
          const wasNewSemesterAddedForStudent = !(
            hadSemAPreviously && hadSemBPreviously
          );

          // Step A: Real cash collected formula
          let actualCashCollectedSoFar = round2(ledger.advance_balance || 0);
          targetSemesters.forEach((s) => {
            actualCashCollectedSoFar += round2(s.amount_paid || 0);
          });
          actualCashCollectedSoFar = round2(actualCashCollectedSoFar);

          // Step B: Update target semesters due amounts
          const semItemsToUpdate = [{ num: sA, due: dueA }];
          if (sB !== null) semItemsToUpdate.push({ num: sB, due: dueB });

          semItemsToUpdate.forEach((item) => {
            let semObj = targetSemesters.find((s) => s.semNumber === item.num);
            if (semObj) {
              semObj.due_amount = item.due;
            } else {
              targetSemesters.push({
                semNumber: item.num,
                due_amount: item.due,
                penalty_amount: 0,
                amount_paid: 0,
                balance_pending: item.due,
              });
            }
          });

          targetSemesters.sort((a, b) => a.semNumber - b.semNumber);

          // Step C: Sequential Waterfall Payment Allocation
          let availableCash = actualCashCollectedSoFar;
          let pureCourseFeesTotal = 0; // Sirf Due Amounts ka Total (No Penalties)
          let totalDemandWithPenalties = 0; // Balance Pending ke liye (Due + Penalty)

          targetSemesters.forEach((sem) => {
            const due = round2(sem.due_amount || 0);
            const penalty = round2(sem.penalty_amount || sem.penalty || 0);

            pureCourseFeesTotal += due;
            const totalSemDemand = round2(due + penalty);
            totalDemandWithPenalties += totalSemDemand;

            if (availableCash >= totalSemDemand) {
              sem.amount_paid = totalSemDemand;
              sem.balance_pending = 0;
              availableCash = round2(availableCash - totalSemDemand);
            } else {
              sem.amount_paid = availableCash;
              sem.balance_pending = round2(totalSemDemand - availableCash);
              availableCash = 0;
            }
          });

          const newAdvanceBalance = round2(availableCash);
          pureCourseFeesTotal = round2(pureCourseFeesTotal);
          totalDemandWithPenalties = round2(totalDemandWithPenalties);

          const totalPaidInSemesters = round2(
            actualCashCollectedSoFar - newAdvanceBalance,
          );
          const overallPending = round2(
            Math.max(0, totalDemandWithPenalties - totalPaidInSemesters),
          );

          // ==========================================
          // Step D: SAFE CLASSES HISTORY UPDATER
          // ==========================================
          let targetHistory = [...(ledger.classesHistory || [])];

          const isHistoryPresent = targetHistory.some(
            (h) =>
              h.className === cleanClass &&
              h.section === cleanSection &&
              Number(h.academicYear) === Number(individualYearNum),
          );

          if (
            !isHistoryPresent &&
            (isEditMode !== "true" || wasNewSemesterAddedForStudent)
          ) {
            targetHistory.push({
              className: cleanClass,
              section: cleanSection,
              academicYear: individualYearNum,
            });
          }

          bulkOperations.push({
            updateOne: {
              filter: {
                student_id: new mongoose.Types.ObjectId(
                  record.student_id.toString(),
                ),
              },
              update: {
                $set: {
                  session: studentSession, // Clean session string
                  semesters: targetSemesters,
                  classesHistory: targetHistory,
                  advance_balance: newAdvanceBalance,
                  total_course_fees: pureCourseFeesTotal,
                  total_amount_paid: actualCashCollectedSoFar,
                  overall_pending_balance: overallPending,
                },
              },
            },
          });
        }
      }

      if (bulkOperations.length > 0) {
        await FeeLedger.bulkWrite(bulkOperations, { session: dbSession });
      }

      await dbSession.commitTransaction();
      req.flash(
        "success",
        isEditMode === "true"
          ? "🎉 Structure updated & recalculated successfully!"
          : "🎉 Batch fee structure saved cleanly.",
      );
      return res.redirect("/add/student/fees");
    } catch (dbError) {
      if (dbSession.inTransaction()) {
        await dbSession.abortTransaction();
      }
      req.flash("error", `❌ Database Refused: ${dbError.message}`);
      return res.redirect(
        `/add/student/fees?className=${encodeURIComponent(className)}&semester=${sA}&section=${encodeURIComponent(section)}`,
      );
    } finally {
      dbSession.endSession();
    }
  }),
);

// function  Semester ko Todne Ke Liye

function getSemesterRangeByClass(className) {
  if (!className) return [1, 8];
  const name = className.toUpperCase();
  if (name.includes("1ST YEAR")) return [1, 2];
  if (name.includes("2ND YEAR")) return [3, 4];
  if (name.includes("3RD YEAR")) return [5, 6];
  if (name.includes("4TH YEAR")) return [7, 8];
  return [1, 8];
}

// ==========================================
// 1. GET ROUTE: STUDENT KI FEES COLLECTION KE LIYE
// ==========================================

app.get(
  "/fees/collect-bulk",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const [classData, sectionData, uniqueYearsData] = await Promise.all([
      Class.find({}).lean(),
      Section.find({}).lean(),

      FeeLedger.distinct("classesHistory.academicYear"),
    ]);

    const academicYearsList = uniqueYearsData
      .filter(Boolean)
      .sort((a, b) => b - a);

    const { className, semester, section, modeSelection, academicYear } =
      req.query;
    let studentsData = [];
    let activeSemesters = [];

    // CSFR / Double Submission Token Guarantee
    const submitToken = crypto.randomBytes(16).toString("hex");
    req.session.lastFeeSubmitToken = submitToken;

    if (className && semester && section && modeSelection && academicYear) {
      const semNum = parseInt(semester);
      const allowedRange = getSemesterRangeByClass(className);

      if (semNum < allowedRange[0] || semNum > allowedRange[1]) {
        req.flash(
          "error",
          `Mismatch: Selected Semester (${semNum}) is not valid for ${className}`,
        );
        return res.redirect("/fees/collect-bulk");
      }

      if (modeSelection === "both") {
        const nextSem = semNum + 1 <= allowedRange[1] ? semNum + 1 : null;
        activeSemesters = [semNum, nextSem];
      } else if (modeSelection === "next") {
        const nextSem = semNum + 1 <= allowedRange[1] ? semNum + 1 : semNum;
        activeSemesters = [nextSem, null];
      } else {
        activeSemesters = [semNum, null];
      }

      const targetYear = parseInt(academicYear);

      // Filtered Indexed Query
      const ledgersRaw = await FeeLedger.find({
        classesHistory: {
          $elemMatch: {
            className: className.trim(),
            section: section.trim(),
            academicYear: targetYear,
          },
        },
        status: "Active",
      }).lean();

      if (!ledgersRaw || ledgersRaw.length === 0) {
        req.flash(
          "error",
          "Data not found! Please check if the Class, Section, or Year is mismatched.",
        );
        return res.redirect("/fees/collect-bulk");
      }

      studentsData = ledgersRaw.map((ledger) => {
        let sortedSemesters = [...(ledger.semesters || [])].sort(
          (a, b) => a.semNumber - b.semNumber,
        );

        // Historical Dues Calculation
        let previousPendingDues = 0;
        sortedSemesters.forEach((s) => {
          if (s.semNumber < activeSemesters[0]) {
            previousPendingDues += s.balance_pending || 0;
          }
        });

        const rawSemA = ledger.semesters?.find(
          (s) => s.semNumber === activeSemesters[0],
        ) || { due_amount: 0, amount_paid: 0, balance_pending: 0 };
        const rawSemB = activeSemesters[1]
          ? ledger.semesters?.find(
              (s) => s.semNumber === activeSemesters[1],
            ) || { due_amount: 0, amount_paid: 0, balance_pending: 0 }
          : { due_amount: 0, amount_paid: 0, balance_pending: 0 };

        const totalYearDues = round2(
          previousPendingDues +
            rawSemA.balance_pending +
            (activeSemesters[1] ? rawSemB.balance_pending : 0),
        );
        const isLocked = totalYearDues <= 0;

        return {
          student_id: ledger.student_id.toString(),
          rollNumber: ledger.rollNumber,
          studentName: ledger.studentName,
          fatherName: ledger.fatherName || "N/A",
          status: ledger.status,
          advanceBalance: round2(ledger.advance_balance || 0),
          previousPendingDues: round2(previousPendingDues),
          semA: {
            num: activeSemesters[0],
            originalDue: round2(rawSemA.due_amount),
            dbAmountPaid: round2(rawSemA.amount_paid),
            dbBalancePending: round2(rawSemA.balance_pending),
            waterfallPending: round2(rawSemA.balance_pending),
          },
          semB: activeSemesters[1]
            ? {
                num: activeSemesters[1],
                originalDue: round2(rawSemB.due_amount),
                dbAmountPaid: round2(rawSemB.amount_paid),
                dbBalancePending: round2(rawSemB.balance_pending),
                waterfallPending: round2(rawSemB.balance_pending),
              }
            : null,
          totalYearDues: totalYearDues,
          isLocked: isLocked,
        };
      });
    }

    res.render("admin/collectBulkFees", {
      classData,
      sectionData,
      academicYearsList,
      students: studentsData,
      activeSemesters,
      submitToken,
      query: req.query || {},
    });
  }),
);

// ==========================================
// 1. POST ROUTE: STUDENT KI FEES COLLECTION KE LIYE
// ==========================================

app.post(
  "/fees/process-bulk-payments",
  verifySession, isAdminVerified,
  validateBulkPayments,
  WrapAsync(async (req, res) => {
    const {
      payments,
      semA,
      semB,
      className,
      section,
      modeSelection,
      submitToken,
      academicYear,
    } = req.body;
    if (
      !className ||
      !payments ||
      !Array.isArray(payments) ||
      payments.length === 0 ||
      !section ||
      !academicYear ||
      !semA ||
      !modeSelection
    ) {
      req.flash(
        "error",
        "⚠️ Security Error: Crucial input parameters missing!",
      );
      return res.redirect("/fees/collect-bulk");
    }

    const sA = parseInt(semA);
    const sB = semB ? parseInt(semB) : null;
    const targetYear = parseInt(academicYear);

    if (
      !req.session.lastFeeSubmitToken ||
      req.session.lastFeeSubmitToken !== submitToken
    ) {
      req.flash(
        "error",
        "⚠️ Duplicate Transaction Prevented! Fresh Token required.",
      );
      return res.redirect(
        `/fees/collect-bulk?className=${encodeURIComponent(className)}&semester=${sA}&section=${encodeURIComponent(section)}&academicYear=${academicYear}&modeSelection=${modeSelection}`,
      );
    }

    req.session.lastFeeSubmitToken = null;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const studentIds = payments.map((p) => p.student_id).filter(Boolean);
      const existingLedgers = await FeeLedger.find({
        student_id: { $in: studentIds },
      }).session(session);
      const ledgerMap = new Map(
        existingLedgers.map((l) => [l.student_id.toString(), l]),
      );

      const bulkOperations = [];
      const transactionRecords = [];
      let receiptCounter = 0;

      for (let payRow of payments) {
        if (payRow.status === "Left College") continue;

        let rawCashPaid = round2(parseFloat(payRow.amountToPay) || 0);
        let runtimeAllocation = rawCashPaid;

        let ledger = ledgerMap.get(payRow.student_id.toString());
        if (!ledger)
          throw new Error(
            `Student ledger not found for ID: ${payRow.student_id}`,
          );

        let targetSemesters = [...(ledger.semesters || [])];
        targetSemesters.sort((a, b) => a.semNumber - b.semNumber);

        let currentAdvance = round2(ledger.advance_balance || 0);
        let initialAdvanceUsed = currentAdvance;
        let receiptBreakdown = [];

        // STAGE 1: Process wallet advance across pending semester dues
        if (currentAdvance > 0) {
          for (let sItem of targetSemesters) {
            let semPenalty = round2(sItem.penalty_amount || sItem.penalty || 0);
            let totalSemDemand = round2((sItem.due_amount || 0) + semPenalty);
            let historyPending = round2(
              Math.max(0, totalSemDemand - (sItem.amount_paid || 0)),
            );

            if (historyPending > 0 && currentAdvance > 0) {
              let absorb = round2(Math.min(currentAdvance, historyPending));
              sItem.amount_paid = round2((sItem.amount_paid || 0) + absorb);
              sItem.balance_pending = round2(
                Math.max(0, totalSemDemand - sItem.amount_paid),
              );
              currentAdvance = round2(currentAdvance - absorb);

              receiptBreakdown.push({
                semNumber: sItem.semNumber,
                amount: absorb,
                source: "Wallet Adjustment",
              });
            }
          }
        }

        // STAGE 2: Allocate fresh incoming liquid cash (Waterfall)
        if (runtimeAllocation > 0) {
          for (let sItem of targetSemesters) {
            let semPenalty = round2(sItem.penalty_amount || sItem.penalty || 0);
            let totalSemDemand = round2((sItem.due_amount || 0) + semPenalty);
            let pendingDues = round2(
              Math.max(0, totalSemDemand - (sItem.amount_paid || 0)),
            );

            if (pendingDues > 0 && runtimeAllocation > 0) {
              let absorbCash = round2(Math.min(runtimeAllocation, pendingDues));
              sItem.amount_paid = round2((sItem.amount_paid || 0) + absorbCash);
              sItem.balance_pending = round2(
                Math.max(0, totalSemDemand - sItem.amount_paid),
              );
              runtimeAllocation = round2(runtimeAllocation - absorbCash);

              receiptBreakdown.push({
                semNumber: sItem.semNumber,
                amount: absorbCash,
                source: "Liquid Cash",
              });
            }
          }

          // STAGE 3: Remaining cash turns into Advance Spillover
          if (runtimeAllocation > 0) {
            currentAdvance = round2(currentAdvance + runtimeAllocation);
            receiptBreakdown.push({
              semNumber: sB || sA,
              amount: runtimeAllocation,
              source: "Advance Spillover Saved",
            });
          }
        }

        const dynamicSumPaid = round2(
          targetSemesters.reduce((sum, s) => sum + (s.amount_paid || 0), 0),
        );
        const overallAmountPaid = round2(dynamicSumPaid + currentAdvance);

        const totalCourseFeesWithPenalty = round2(
          targetSemesters.reduce((sum, s) => {
            return (
              sum + (s.due_amount || 0) + (s.penalty_amount || s.penalty || 0)
            );
          }, 0),
        );

        const compositePendingBalance = round2(
          Math.max(0, totalCourseFeesWithPenalty - dynamicSumPaid),
        );
        const advanceAbsorbed = round2(initialAdvanceUsed - currentAdvance);

        if (rawCashPaid > 0 || advanceAbsorbed > 0) {
          receiptCounter++;
          const uniqueReceiptNo = `REC-${Date.now()}-${receiptCounter}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

          transactionRecords.push({
            receiptNumber: uniqueReceiptNo,
            student_id: payRow.student_id,
            rollNumber: payRow.rollNumber,
            academicYear: targetYear,
            studentName: payRow.studentName,
            fatherName: ledger.fatherName,
            semNumber: sA,
            amountPaid: rawCashPaid,
            paymentMode: payRow.paymentMode || "Cash",
            status: "ACTIVE",
            metadata: {
              breakdown: receiptBreakdown,
              walletAdvanceSubtracted: advanceAbsorbed,
              retainedWalletAdvance: currentAdvance,
            },
          });
        }

        bulkOperations.push({
          updateOne: {
            filter: { student_id: payRow.student_id },
            update: {
              $set: {
                semesters: targetSemesters,
                advance_balance: currentAdvance,
                total_amount_paid: overallAmountPaid,
                overall_pending_balance: compositePendingBalance,
              },
            },
          },
        });
      }

      if (bulkOperations.length > 0) {
        if (transactionRecords.length > 0) {
          await FeeTransaction.insertMany(transactionRecords, { session });
        }
        await FeeLedger.bulkWrite(bulkOperations, { session });
      }

      await session.commitTransaction();
      req.flash("success", "🚀 Complete Ledger Sequence synced successfully.");
      return res.redirect(
        `/fees/collect-bulk?className=${encodeURIComponent(className)}&semester=${sA}&section=${encodeURIComponent(section)}&academicYear=${academicYear}&modeSelection=${modeSelection}`,
      );
    } catch (error) {
      await session.abortTransaction();
      req.flash(
        "error",
        `Error encountered during batch sequence processing: ${error.message}`,
      );
      return res.redirect(
        `/fees/collect-bulk?className=${encodeURIComponent(className)}&semester=${sA}&section=${encodeURIComponent(section)}&academicYear=${academicYear}&modeSelection=${modeSelection}`,
      );
    } finally {
      session.endSession();
    }
  }),
);

// OVERALL STUDENT KI FEES COLLECTION KA DATA DEKHNE KE LIYE


// Yeh NAYA route add hoga (Existing dashboard route ko touch kiye bina)
app.get(
  "/api/fee/batches",
  verifySession,
  isAdminVerified,
  WrapAsync(async (req, res) => {
    let { course } = req.query;

    if (!course || typeof course !== "string") {
      return res.json({ success: true, batches: [] });
    }

    course = course.trim();

    // DHYAN DEIN: Agar aapke FeeLedger me field ka naam 'baseCourse' ya 'course' hai, 
    // toh neeche 'currentCourse' ko usse replace kar lein.
    const rawBatches = await FeeLedger.distinct("session", { currentCourse: course });

    // Filter null/undefined and sort alphabetically/chronologically
    const batches = rawBatches
      .filter(Boolean)
      .map(b => String(b).trim())
      .sort((a, b) => b.localeCompare(a)); // Newest batch pehele (e.g. 2024-28, 2023-27)

    return res.json({ success: true, batches });
  })
);


app.get(
  "/show/fee/dashboard",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { baseCourse, batchSession } = req.query;

    const rawBaseCourses = await FeeLedger.distinct("currentCourse");
    const allBaseCourses = rawBaseCourses.filter(Boolean);

    const rawBatches = await FeeLedger.distinct("session");
    const allBatches = rawBatches.filter(Boolean);

    let sectionwiseData = {};
    let overallDashboard = {
      totalFee: 0,
      totalPaid: 0,
      totalAdvance: 0,
      totalPenalty: 0,
      netPending: 0,
      totalCollected: 0,
    };

    if (baseCourse && batchSession) {
      const query = { currentCourse: baseCourse, session: batchSession };

      const studentsLedger = await FeeLedger.find(query).lean();

      // Safety check for student ObjectIds / String IDs
      const studentIds = studentsLedger
        .map((s) =>
          s.student_id
            ? s.student_id.toString()
            : s._id
              ? s._id.toString()
              : null,
        )
        .filter(Boolean);

      const allTransactions = await FeeTransaction.find({
        student_id: { $in: studentIds },
      })
        .sort({ paymentDate: -1 })
        .lean();

      const txMap = new Map();
      allTransactions.forEach((tx) => {
        const sId = tx.student_id ? tx.student_id.toString() : "";
        if (sId) {
          if (!txMap.has(sId)) txMap.set(sId, []);
          txMap.get(sId).push(tx);
        }
      });

      studentsLedger.forEach((student) => {
        let secName = "A";
        if (
          Array.isArray(student.classesHistory) &&
          student.classesHistory.length > 0
        ) {
          secName =
            student.classesHistory[student.classesHistory.length - 1].section ||
            "A";
        } else if (student.section) {
          secName = student.section;
        }
        secName = secName.toUpperCase();

        if (!sectionwiseData[secName]) {
          sectionwiseData[secName] = {
            summary: {
              totalFee: 0,
              totalPaid: 0,
              totalAdvance: 0,
              totalPenalty: 0,
              netPending: 0,
              totalCollected: 0,
            },
            yearlyBreakdown: {
              "1ST YEAR": { demand: 0, paid: 0, penalty: 0, pending: 0 },
              "2ND YEAR": { demand: 0, paid: 0, penalty: 0, pending: 0 },
              "3RD YEAR": { demand: 0, paid: 0, penalty: 0, pending: 0 },
              "4TH YEAR": { demand: 0, paid: 0, penalty: 0, pending: 0 }, // ✅ FIX 1: Added 4th Year
            },
            students: [],
          };
        }

        let studentTotalDue = 0;
        let studentTotalPaidSemsters = 0;
        let studentTotalPenalty = 0;

        const studentIdStr = student.student_id
          ? student.student_id.toString()
          : student._id
            ? student._id.toString()
            : "";
        student.paymentHistory = txMap.get(studentIdStr) || [];

        if (Array.isArray(student.semesters)) {
          student.semesters.forEach((sem) => {
            const semDue = Number(sem.due_amount) || 0;
            const semPaid = Number(sem.amount_paid) || 0;
            const semPenalty = Number(sem.penalty_amount || sem.penalty) || 0;

            sem.calculated_pending = Math.max(0, semDue + semPenalty - semPaid);

            studentTotalDue += semDue;
            studentTotalPaidSemsters += semPaid;
            studentTotalPenalty += semPenalty;

            // ✅ FIX 2: Dynamic Year-Wise Tagging (Supports up to 8 Semesters)
            let yTag = "1ST YEAR";
            if (sem.semNumber === 3 || sem.semNumber === 4) {
              yTag = "2ND YEAR";
            } else if (sem.semNumber === 5 || sem.semNumber === 6) {
              yTag = "3RD YEAR";
            } else if (sem.semNumber >= 7) {
              yTag = "4TH YEAR";
            }

            if (sectionwiseData[secName].yearlyBreakdown[yTag]) {
              const yRef = sectionwiseData[secName].yearlyBreakdown[yTag];
              yRef.demand += semDue;
              yRef.paid += semPaid;
              yRef.penalty += semPenalty;
              yRef.pending += sem.calculated_pending;
            }
          });
        }

        const advance = Number(student.advance_balance) || 0;
        const netStudentPending = Math.max(
          0,
          studentTotalDue + studentTotalPenalty - studentTotalPaidSemsters,
        );

        const studentTotalCollected =
          Number(student.total_amount_paid) ||
          studentTotalPaidSemsters + advance;

        student.total_allocated_paid = studentTotalPaidSemsters;
        student.total_penalty_amount = studentTotalPenalty;
        student.overall_pending_balance = netStudentPending;

        // Section Summaries
        const secSum = sectionwiseData[secName].summary;
        secSum.totalFee += studentTotalDue;
        secSum.totalPaid += studentTotalPaidSemsters;
        secSum.totalPenalty += studentTotalPenalty;
        secSum.totalAdvance += advance;
        secSum.netPending += netStudentPending;
        secSum.totalCollected += studentTotalCollected;

        // Overall Dashboard Summaries
        overallDashboard.totalFee += studentTotalDue;
        overallDashboard.totalPaid += studentTotalPaidSemsters;
        overallDashboard.totalPenalty += studentTotalPenalty;
        overallDashboard.totalAdvance += advance;
        overallDashboard.netPending += netStudentPending;
        overallDashboard.totalCollected += studentTotalCollected;

        sectionwiseData[secName].students.push(student);
      });
    }

    res.render("admin/showFeeData.ejs", {
      allBaseCourses,
      allBatches,
      selectedBaseCourse: baseCourse || "",
      selectedBatch: batchSession || "",
      sectionwiseData,
      overallDashboard,
    });
  }),
);

// PDF ROUTE HAI UNPAID FEES  KE STUDENT KO FIND KE LIYE

app.get(
  "/export/fee/unpaid-pdf",
 verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    const { baseCourse, batchSession, section, sem } = req.query;
    const selectedSems = Array.isArray(sem)
      ? sem.map(Number)
      : sem
        ? [Number(sem)]
        : [];

    const query = { currentCourse: baseCourse, session: batchSession };
    const students = await FeeLedger.find(query).lean();

    const filteredList = students.filter((student) => {
      let secName = "A";
      if (
        Array.isArray(student.classesHistory) &&
        student.classesHistory.length > 0
      ) {
        secName =
          student.classesHistory[student.classesHistory.length - 1].section ||
          "A";
      } else if (student.section) {
        secName = student.section;
      }
      if (secName.toUpperCase() !== section.toUpperCase()) return false;

      // Check if student has pending dues in any of selected semesters
      if (selectedSems.length === 0) return true;

      return student.semesters.some((s) => {
        if (selectedSems.includes(s.semNumber)) {
          const pending =
            (s.due_amount || 0) +
            (s.penalty_amount || 0) -
            (s.amount_paid || 0);
          return pending > 0;
        }
        return false;
      });
    });

    // Construct HTML for PDF
    let htmlContent = `
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h2 { text-align: center; margin-bottom: 5px; }
        p { text-align: center; color: #555; font-size: 14px; margin-top: 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
        th, td { border: 1px solid #000; padding: 8px; text-align: center; }
        th { background-color: #f2f2f2; }
        .text-start { text-align: left; }
      </style>
    </head>
    <body>
      <h2>${baseCourse} (${batchSession}) - Section ${section}</h2>
      <p>Unpaid Dues Report (Semesters: ${selectedSems.join(", ") || "All"})</p>
      <table>
        <thead>
          <tr>
            <th>Admin No</th>
            <th class="text-start">Student Name</th>
            <th class="text-start">Father Name</th>
            ${selectedSems.map((s) => `<th>Sem-${s} Pending Dues</th>`).join("")}
            <th>Total Pending Balance</th>
          </tr>
        </thead>
        <tbody>
  `;

    filteredList.forEach((st) => {
      let totalSelPending = 0;
      let semColsHtml = "";

      selectedSems.forEach((sNum) => {
        const targetSem = st.semesters.find((s) => s.semNumber === sNum);
        if (targetSem) {
          const semPending = Math.max(
            0,
            (targetSem.due_amount || 0) +
              (targetSem.penalty_amount || 0) -
              (targetSem.amount_paid || 0),
          );
          totalSelPending += semPending;
          semColsHtml += `<td>₹${semPending.toLocaleString("en-IN")}</td>`;
        } else {
          semColsHtml += `<td>₹0</td>`;
        }
      });

      htmlContent += `
      <tr>
        <td><b>${st.rollNumber}</b></td>
        <td class="text-start">${st.studentName}</td>
        <td class="text-start">${st.fatherName || "N/A"}</td>
        ${semColsHtml}
        <td style="color: red; font-weight: bold;">₹${totalSelPending.toLocaleString("en-IN")}</td>
      </tr>
    `;
    });

    htmlContent += `
        </tbody>
      </table>
    </body>
    </html>
  `;

    const options = { format: "A4", landscape: true };
    const file = { content: htmlContent };

    pdf
      .generatePdf(file, options)
      .then((pdfBuffer) => {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=Unpaid_Fee_Sec_${section}.pdf`,
        );
        res.send(pdfBuffer);
      })
      .catch((err) => {
        res.status(500).send("Error generating PDF: " + err.message);
      });
  }),
);

// ==========================================
// 1. POST: ADD FEE PENALTY (Session/Transaction Safe)
// ==========================================
app.post(
  "/add/fee/penalty",
  verifySession, isAdminVerified,
  preventUnauthorizedAPICalls,
  WrapAsync(async (req, res) => {
    const { penalties, targetSem } = req.body;

    if (!penalties || !Array.isArray(penalties) || penalties.length === 0) {
      return res.status(400).json({
        success: false,
        message: "⚠️ No student penalty records found!",
      });
    }

    const semNum = Number(targetSem);
    if (isNaN(semNum) || semNum < 1 || semNum > 8) {
      return res.status(400).json({
        success: false,
        message: "⚠️ Invalid target semester selected!",
      });
    }

    let updatedStudents = [];
    let skippedNoStructure = [];
    let skippedFeePaid = [];
    let skippedInvalidAmount = [];

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        for (const item of penalties) {
          const { studentId, penalty } = item;
          const addPenaltyAmt = Number(penalty) || 0;

          if (addPenaltyAmt <= 0) {
            skippedInvalidAmount.push(studentId);
            continue;
          }

          const isValidObjectId = mongoose.Types.ObjectId.isValid(studentId);

          // Safe Multi-field Search
          const ledger = await FeeLedger.findOne({
            $or: [
              ...(isValidObjectId
                ? [{ student_id: studentId }, { _id: studentId }]
                : []),
              { rollNumber: studentId },
            ],
          }).session(session);

          if (!ledger) {
            skippedNoStructure.push({
              name: studentId,
              roll: "N/A",
              reason: "Ledger Record Not Found",
            });
            continue;
          }

          if (
            !Array.isArray(ledger.semesters) ||
            ledger.semesters.length === 0
          ) {
            skippedNoStructure.push({
              name: ledger.studentName,
              roll: ledger.rollNumber,
              reason: "No Semesters Defined",
            });
            continue;
          }

          const semIndex = ledger.semesters.findIndex(
            (s) => Number(s.semNumber) === semNum,
          );
          if (semIndex === -1) {
            skippedNoStructure.push({
              name: ledger.studentName,
              roll: ledger.rollNumber,
              reason: `Sem ${semNum} Structure Not Added`,
            });
            continue;
          }

          const targetSemObj = ledger.semesters[semIndex];
          const currentDue = Number(targetSemObj.due_amount) || 0;

          if (currentDue <= 0) {
            skippedNoStructure.push({
              name: ledger.studentName,
              roll: ledger.rollNumber,
              reason: `Sem ${semNum} Fee Structure Not Defined / Due is 0`,
            });
            continue;
          }

          const currentPaid = Number(targetSemObj.amount_paid) || 0;
          if (currentPaid > 0) {
            skippedFeePaid.push({
              name: ledger.studentName,
              roll: ledger.rollNumber,
              reason: `Sem ${semNum} Fee Already Paid (₹${currentPaid.toLocaleString("en-IN")})`,
            });
            continue;
          }

          const existingPenalty = Number(targetSemObj.penalty_amount) || 0;
          const newSemPenalty = existingPenalty + addPenaltyAmt;

          ledger.semesters[semIndex].penalty_amount = newSemPenalty;
          ledger.semesters[semIndex].balance_pending = Math.max(
            0,
            currentDue + newSemPenalty - currentPaid,
          );

          // Master Recalculation
          let totalDueSum = 0;
          let totalPaidSum = 0;
          let totalPenaltySum = 0;

          ledger.semesters.forEach((sem) => {
            totalDueSum += Number(sem.due_amount) || 0;
            totalPaidSum += Number(sem.amount_paid) || 0;
            totalPenaltySum += Number(sem.penalty_amount) || 0;
          });

          ledger.total_course_fees = totalDueSum;
          ledger.total_penalty_amount = totalPenaltySum;
          ledger.overall_pending_balance = Math.max(
            0,
            totalDueSum + totalPenaltySum - totalPaidSum,
          );

          ledger.markModified("semesters");
          await ledger.save({ session });
          updatedStudents.push({
            name: ledger.studentName,
            roll: ledger.rollNumber,
            added: addPenaltyAmt,
          });
        }
      });

      await session.endSession();

      let finalMsg = `✅ Penalty has been successfully saved for ${updatedStudents.length} students in Semester ${semNum}.`;

      if (skippedNoStructure.length > 0) {
        finalMsg += `\n\n⚠️ ${skippedNoStructure.length} students were skipped (No structure / Due 0).\n`;
        skippedNoStructure.forEach((item) => {
          finalMsg += `• ${item.name} (${item.roll}): ${item.reason}\n`;
        });
      }

      if (skippedFeePaid.length > 0) {
        finalMsg += `\n\n🛑 ${skippedFeePaid.length} students were skipped (Fee already paid).\n`;
        skippedFeePaid.forEach((item) => {
          finalMsg += `• ${item.name} (${item.roll}): ${item.reason}\n`;
        });
      }

      return res.json({
        success: true,
        message: finalMsg,
        updatedCount: updatedStudents.length,
        skippedStructureCount: skippedNoStructure.length,
        skippedFeePaidCount: skippedFeePaid.length,
        skippedDetails: [...skippedNoStructure, ...skippedFeePaid],
      });
    } catch (error) {
      await session.endSession();
      console.error("Penalty Add Transaction Error:", error);
      return res.status(500).json({
        success: false,
        message: "❌ Transaction failed! All changes rolled back.",
        error: error.message,
      });
    }
  }),
);

// ==========================================
// 2. DELETE: REMOVE FEE PENALTY
// ==========================================
app.delete(
  "/remove/fee/penalty",
 verifySession, isAdminVerified,
  preventUnauthorizedAPICalls,
  WrapAsync(async (req, res) => {
    try {
      const { studentId, targetSem } = req.body;

      if (!studentId || !targetSem) {
        return res.status(400).json({
          success: false,
          message: "Student ID and Target Semester are required!",
        });
      }

      const isValidObjectId = mongoose.Types.ObjectId.isValid(studentId);

      // Direct FeeLedger Search
      const ledger = await FeeLedger.findOne({
        $or: [
          ...(isValidObjectId
            ? [{ _id: studentId }, { student_id: studentId }]
            : []),
          { rollNumber: studentId },
        ],
      });

      if (!ledger) {
        return res.status(404).json({
          success: false,
          message: "Student Fee Ledger not found!",
        });
      }

      const semIndex = ledger.semesters.findIndex(
        (s) => Number(s.semNumber) === Number(targetSem),
      );

      if (semIndex === -1) {
        return res.status(404).json({
          success: false,
          message: `Semester ${targetSem} entry not found in ledger!`,
        });
      }

      const targetSemester = ledger.semesters[semIndex];
      const paidAmt = Number(targetSemester.amount_paid) || 0;

      if (paidAmt > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot remove penalty! Fees are already paid (₹${paidAmt}) for Semester ${targetSem}.`,
        });
      }

      // Reset Penalty for Target Sem
      ledger.semesters[semIndex].penalty_amount = 0;

      // Comprehensive Overall Ledger Recalculation
      let overallDue = 0;
      let overallPaid = 0;
      let overallPenalty = 0;

      ledger.semesters.forEach((sem) => {
        const d = Number(sem.due_amount) || 0;
        const p = Number(sem.penalty_amount) || 0;
        const pd = Number(sem.amount_paid) || 0;

        sem.balance_pending = Math.max(0, d + p - pd);

        overallDue += d;
        overallPenalty += p;
        overallPaid += pd;
      });

      ledger.total_course_fees = overallDue;
      ledger.total_penalty_amount = overallPenalty;
      ledger.total_amount_paid = overallPaid;
      ledger.overall_pending_balance = Math.max(
        0,
        overallDue + overallPenalty - overallPaid,
      );

      ledger.markModified("semesters");
      await ledger.save();

      return res.status(200).json({
        success: true,
        message: `Penalty removed successfully for Semester ${targetSem}!`,
      });
    } catch (error) {
      console.error("Penalty Removal Controller Error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error: " + error.message,
      });
    }
  }),
);

// Helper to deduce sem numbers from Year Tag
function getSemsFromYearTag(yearTag) {
  switch (yearTag?.trim()?.toUpperCase()) {
    case "1ST YEAR":
      return [1, 2];
    case "2ND YEAR":
      return [3, 4];
    case "3RD YEAR":
      return [5, 6];
    case "4TH YEAR":
      return [7, 8];
    default:
      return [];
  }
}

// Waterfall Recalculator - Syncs Schema
function recalculateLedgerWaterfall(ledger) {
  let targetSemesters = Array.isArray(ledger.semesters) ? ledger.semesters : [];
  let actualCashCollectedSoFar = round2(ledger.total_amount_paid || 0);

  let availableCash = actualCashCollectedSoFar;
  let pureCourseFeesTotal = 0;
  let totalDemandWithPenalties = 0;

  targetSemesters.forEach((sem) => {
    sem.amount_paid = 0;
    const due = round2(sem.due_amount || 0);
    const penalty = round2(sem.penalty_amount || 0);
    sem.balance_pending = round2(due + penalty);
  });

  targetSemesters.forEach((sem) => {
    const due = round2(sem.due_amount || 0);
    const penalty = round2(sem.penalty_amount || 0);
    pureCourseFeesTotal += due;
    const totalSemDemand = round2(due + penalty);
    totalDemandWithPenalties += totalSemDemand;

    if (availableCash >= totalSemDemand) {
      sem.amount_paid = totalSemDemand;
      sem.balance_pending = 0;
      availableCash = round2(availableCash - totalSemDemand);
    } else {
      sem.amount_paid = availableCash;
      sem.balance_pending = round2(totalSemDemand - availableCash);
      availableCash = 0;
    }
  });

  ledger.advance_balance = round2(availableCash);
  ledger.total_course_fees = round2(pureCourseFeesTotal);
  const totalPaidInSemesters = round2(
    actualCashCollectedSoFar - ledger.advance_balance,
  );
  ledger.overall_pending_balance = round2(
    Math.max(0, totalDemandWithPenalties - totalPaidInSemesters),
  );
  ledger.semesters = targetSemesters;

  if (typeof ledger.markModified === "function") {
    ledger.markModified("semesters");
    ledger.markModified("classesHistory");
  }
}

// ====================================================
// 🗑️ DELETE FEE STRUCTURE (Exact DB Structure Match)
// ====================================================
app.post(
  "/api/delete-fee-structure",
  verifySession, isAdminVerified,
  preventUnauthorizedAPICalls,
  WrapAsync(async (req, res) => {
    const { fullClassName, batchSession, section, yearTag, studentIds } =
      req.body;
    console.log(fullClassName, batchSession, section, yearTag);

    // 🔍 Helper: Extra spaces/tabs ko single space me convert karne aur uppercase karne ke liye
    const cleanStr = (str) =>
      (str || "").toString().trim().replace(/\s+/g, " ").toUpperCase();

    const targetSems = getSemsFromYearTag(yearTag);

    if (
      !fullClassName ||
      !batchSession ||
      !section ||
      !targetSems ||
      targetSems.length === 0 ||
      !Array.isArray(studentIds) ||
      studentIds.length === 0
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "⚠️ Security Error: Crucial parameters missing!",
        });
    }

    // Frontend se aa raha hai: "B.TECH CSE 2ND YEAR"
    const targetClassName = cleanStr(fullClassName);
    const targetBatch = batchSession.trim();
    const targetSection = cleanStr(section);

    const dbSession = await mongoose.startSession();

    try {
      dbSession.startTransaction();

      // 🔒 1. Query Target Batch & Students
      const ledgers = await FeeLedger.find({
        session: targetBatch,
        $or: [
          { student_id: { $in: studentIds } },
          { _id: { $in: studentIds } },
        ],
      }).session(dbSession);

      if (!ledgers || ledgers.length === 0) {
        await dbSession.abortTransaction();
        return res.status(404).json({
          success: false,
          message: `🚨 Fee Structure NOT found for Session ${targetBatch}!`,
        });
      }

      // 🔒 2. STRICT HISTORY MATCHING (Direct className Match)
      let invalidStudents = [];

      for (let ledger of ledgers) {
        // Direct comparison with classesHistory[x].className (e.g. "B.TECH CSE 2ND YEAR")
        const hasExactClass = (ledger.classesHistory || []).some((h) => {
          const dbClassName = cleanStr(h.className);
          const dbSection = cleanStr(h.section);

          return dbClassName === targetClassName && dbSection === targetSection;
        });

        if (!hasExactClass) {
          invalidStudents.push(
            `"${ledger.studentName || "Student"}" (Admin no: ${ledger.rollNumber || "N/A"})`,
          );
        }
      }

      if (invalidStudents.length > 0) {
        await dbSession.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `🚨 Aborted! Structure "${targetClassName}" (Sec ${targetSection}) was NOT found in history for: ${invalidStudents.join(", ")}.`,
        });
      }

      // 🔒 3. GUARD CLAUSE: Payment Check for Target Semesters
      let blockedStudents = [];
      for (let ledger of ledgers) {
        const paidInTarget = (ledger.semesters || []).some(
          (s) =>
            targetSems.includes(Number(s.semNumber)) &&
            round2(s.amount_paid) > 0,
        );

        if (paidInTarget) {
          blockedStudents.push(
            `"${ledger.studentName || "Student"}" (Admin no: ${ledger.rollNumber || "N/A"})`,
          );
        }
      }

      if (blockedStudents.length > 0) {
        await dbSession.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `🚨 Delete Blocked! Fees already collected for Semester(s) [${targetSems.join(", ")}] for: ${blockedStudents.join(", ")}.`,
        });
      }

      // 🔒 4. PERFORM SAFE DELETION
      let deletedCount = 0;

      for (let ledger of ledgers) {
        // Step A: Target Semesters Filter Out
        ledger.semesters = (ledger.semesters || []).filter(
          (s) => !targetSems.includes(Number(s.semNumber)),
        );

        // Step B: Target Class History Entry Filter Out
        ledger.classesHistory = (ledger.classesHistory || []).filter((h) => {
          const dbClassName = cleanStr(h.className);
          const dbSection = cleanStr(h.section);

          const isTarget =
            dbClassName === targetClassName && dbSection === targetSection;
          return !isTarget; // Retain non-matching entries
        });

        // Step C: Document Delete vs Waterfall Recalculation
        if (ledger.semesters.length === 0) {
          await FeeLedger.deleteOne({ _id: ledger._id }).session(dbSession);
        } else {
          if (typeof recalculateLedgerWaterfall === "function") {
            recalculateLedgerWaterfall(ledger);
          }

          ledger.markModified("semesters");
          ledger.markModified("classesHistory");

          await ledger.save({ session: dbSession });
        }
        deletedCount++;
      }

      await dbSession.commitTransaction();
      return res.json({
        success: true,
        message: `🎉 Successfully deleted "${targetClassName}" (Sec ${targetSection}) for ${deletedCount} student(s)!`,
      });
    } catch (error) {
      if (dbSession.inTransaction()) {
        await dbSession.abortTransaction();
      }
      console.error("Delete Structure Fatal Error:", error);
      return res
        .status(500)
        .json({ success: false, message: "❌ Server Error: " + error.message });
    } finally {
      dbSession.endSession();
    }
  }),
);

// ====================================================
// 2. UPDATE RECEIPT (Password + Reason + Max 2 Edits Log)
// ====================================================
app.put(
  "/api/update-fee-receipt",
  verifySession, isAdminVerified,
  preventUnauthorizedAPICalls,
  WrapAsync(async (req, res) => {
    const { txId, studentId, amountPaid, paymentMode, password, editReason } =
      req.body;
    const newAmount = round2(amountPaid);

    if (password !== ADMIN_PASSWORD) {
      return res
        .status(401)
        .json({
          success: false,
          message: "🔑 Incorrect Admin Verification Password!",
        });
    }

    if (!editReason || editReason.trim().length < 3) {
      return res
        .status(400)
        .json({
          success: false,
          message: "⚠️ Valid reason is strictly required for auditing!",
        });
    }

    const dbSession = await mongoose.startSession();

    try {
      dbSession.startTransaction();

      const transaction = await FeeTransaction.findOne({
        _id: txId,
        status: "ACTIVE",
      }).session(dbSession);
      if (!transaction) {
        await dbSession.abortTransaction();
        return res
          .status(404)
          .json({
            success: false,
            message: "Active receipt transaction not found!",
          });
      }

      const currentEditCount = transaction.editCount || 0;
      if (currentEditCount >= 2) {
        await dbSession.abortTransaction();
        return res
          .status(403)
          .json({
            success: false,
            message:
              "🛑 Max limit reached! This receipt has already been edited 2 times.",
          });
      }

      // Save Reason in Main Schema + Metadata History
      const previousAmount = transaction.amountPaid;
      transaction.amountPaid = newAmount;
      if (paymentMode) transaction.paymentMode = paymentMode;
      transaction.editCount = currentEditCount + 1;
      transaction.actionReason = editReason;

      if (!transaction.metadata) transaction.metadata = {};
      if (!transaction.metadata.editLogs) transaction.metadata.editLogs = [];

      transaction.metadata.editLogs.push({
        editedAt: new Date(),
        previousAmount: previousAmount,
        newAmount: newAmount,
        reason: editReason,
      });

      await transaction.save({ session: dbSession });

      // Sync FeeLedger
      const ledger = await FeeLedger.findOne({
        $or: [{ student_id: studentId }, { _id: studentId }],
      }).session(dbSession);

      if (ledger) {
        const activeTxs = await FeeTransaction.find({
          student_id: ledger.student_id,
          status: "ACTIVE",
        }).session(dbSession);

        const grandTotalPaid = activeTxs.reduce(
          (sum, tx) => sum + round2(tx.amountPaid),
          0,
        );
        ledger.total_amount_paid = round2(grandTotalPaid);
        recalculateLedgerWaterfall(ledger);
        await ledger.save({ session: dbSession });
      }

      await dbSession.commitTransaction();
      return res.json({
        success: true,
        message: `🎉 Receipt updated! (Edit ${currentEditCount + 1}/2 Recorded)`,
      });
    } catch (err) {
      if (dbSession.inTransaction()) await dbSession.abortTransaction();
      return res.status(500).json({ success: false, message: err.message });
    } finally {
      dbSession.endSession();
    }
  }),
);

// ====================================================
// 3. CANCEL RECEIPT (Saves Reason in Metadata & Schema)
// ====================================================
app.post(
  "/api/cancel-fee-receipt",
  verifySession, isAdminVerified,
  preventUnauthorizedAPICalls,
  WrapAsync(async (req, res) => {
    const { txId, studentId, password, cancelReason } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res
        .status(401)
        .json({
          success: false,
          message: "🔑 Incorrect Admin Verification Password!",
        });
    }

    if (!cancelReason || cancelReason.trim().length < 3) {
      return res
        .status(400)
        .json({
          success: false,
          message: "⚠️ Cancellation reason is required!",
        });
    }

    const dbSession = await mongoose.startSession();

    try {
      dbSession.startTransaction();

      const transaction = await FeeTransaction.findOne({
        _id: txId,
        status: "ACTIVE",
      }).session(dbSession);
      if (!transaction) {
        await dbSession.abortTransaction();
        return res
          .status(404)
          .json({
            success: false,
            message: "Active transaction not found or already cancelled!",
          });
      }

      // Save Cancellation Status & Reasons
      transaction.status = "CANCELLED";
      transaction.actionReason = cancelReason;

      if (!transaction.metadata) transaction.metadata = {};
      transaction.metadata.cancellationReason = cancelReason;
      transaction.metadata.cancelledAt = new Date();

      await transaction.save({ session: dbSession });

      // Sync Ledger (Subtracts Cancelled Amount automatically)
      const ledger = await FeeLedger.findOne({
        $or: [{ student_id: studentId }, { _id: studentId }],
      }).session(dbSession);

      if (ledger) {
        const activeTxs = await FeeTransaction.find({
          student_id: ledger.student_id,
          status: "ACTIVE",
        }).session(dbSession);

        const grandTotalPaid = activeTxs.reduce(
          (sum, tx) => sum + round2(tx.amountPaid),
          0,
        );
        ledger.total_amount_paid = round2(grandTotalPaid);
        recalculateLedgerWaterfall(ledger);
        await ledger.save({ session: dbSession });
      }

      await dbSession.commitTransaction();
      return res.json({
        success: true,
        message:
          "✅ Receipt marked as CANCELLED. Ledger recalculated successfully!",
      });
    } catch (err) {
      if (dbSession.inTransaction()) await dbSession.abortTransaction();
      return res.status(500).json({ success: false, message: err.message });
    } finally {
      dbSession.endSession();
    }
  }),
);

// --------------------------------------MESSAGING START-------------------------------------------------------


//---------------------------------------MESSAGING COLSE--------------------------------------------------------

// app.get("/admin/logout",  verifySession, isAdminVerified,(req, res) => {
//   // Clear ALL Admin Session Variables
//   delete req.session.userId;
//   delete req.session.adminVerified;
//   delete req.session.role;
//   delete req.session.loginTime;

//   req.session.save((err) => {
//     if (err) console.error("Admin Logout Session Save Error:", err);
//     req.flash("success", "Logged out successfully!");
//     return res.redirect("/student/attendance/login");
//   });
// });

app.get("/admin/logout", verifySession, isAdminVerified, (req, res) => {
  // 1. Session ID regenerate karein taaki purani Admin Session Keys completely destroy ho jayein
  req.session.regenerate((err) => {
    if (err) {
      console.error("Admin Logout Session Regenerate Error:", err);
      return res.redirect("/student/attendance/login");
    }

    // 2. Fresh & Clean Session mein Flash Message set karein
    req.flash("success", "Logged out successfully!");

    // 3. Save and Redirect
    req.session.save((saveErr) => {
      if (saveErr) console.error("Admin Logout Session Save Error:", saveErr);
      return res.redirect("/student/attendance/login");
    });
  });
});

// ---------------------------------------------------- Admin folder closed------------------------------------------------------------------

// -------------------------------------------------- teachers folders starts -----------------------------------------------------

// login  teacher

// app.post(
//   "/login/modal",

//   passport.authenticate("local", {
//     failureRedirect: "/student/attendance/login",
//     failureFlash: true,
//   }),
//   async (req, res) => {
//     req.flash("success", "Login Successfully");
//     res.redirect("/teacher/student/attendance");
//   },
// );




// app.post("/login/modal", (req, res, next) => {
//   passport.authenticate("local", (err, teacher, info) => {
//     if (err) {
//       console.error("Passport Auth Error:", err);
//       req.flash("error", "Something went wrong during authentication.");
//       return res.redirect("/student/attendance/login");
//     }

//     // 🔴 1. INVALID CREDENTIALS
//     if (!teacher) {
//       req.flash("error", info?.message || "Invalid username or password");
//       return res.redirect("/student/attendance/login");
//     }

//     // 🔴 2. BLOCKED TEACHER CHECK
//     if (teacher.status === "Blocked") {
//       req.flash(
//         "error",
//         "Your account is blocked by administrator. Access denied.",
//       );
//       return res.redirect("/student/attendance/login");
//     }

//     // 🔴 3. PASSPORT REQ.LOGIN EXECUTION
//     req.logIn(teacher, (loginErr) => {
//       if (loginErr) {
//         console.error("Req Login Error:", loginErr);
//         req.flash("error", "Failed to initialize session.");
//         return res.redirect("/student/attendance/login");
//       }

//       const teacherRole = process.env.ROLE_2 || "Teacher";

//       // 🔴 4. SESSION CLEANUP (Admin/Student Variables Remove Karo)
//       delete req.session.adminVerified;
//       delete req.session.otpVerified;
//       delete req.session.rollNo;
//       delete req.session.studentId;

//       // 🔴 5. MANDATORY SESSION VARIABLES FOR ISLOGGEDIN MIDDLEWARE & MULTI-DEVICE LOGOUT
//       req.session.userId = teacher._id.toString(); // 👈 Compulsory for isLoggedIn
//       req.session.role = teacherRole;
//       req.session.loginTime = req.session.loginTime = new Date().toISOString(); // 👈 Compulsory for passwordChangedAt comparison

//       // 🔴 6. FORCE SAVE SESSION BEFORE REDIRECT
//       return req.session.save((saveErr) => {
//         if (saveErr) console.error("Session Save Error:", saveErr);
//         req.flash("success", `Welcome back, ${teacher.name}!`);
//         return res.redirect("/teacher/student/attendance");
//       });
//     });
//   })(req, res, next);
// });

// teacher profile

app.get(
  "/teacher/profile",
   verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    let data = await Teacher.findById(req.user._id);

    if (!data) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }

    res.render("teachers/profile.ejs", { data });
  }),
);

// profile edit

app.get(
  "/teacher/profile/edit/:id",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let data = await Teacher.findById(id);
    res.render("teachers/editProfile.ejs", { id, data });
  }),
);

app.put(
  "/teacher/profile/edit/:id",
    verifySession, isLoggedIn,
  upload.single("data[image]"),
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let teacher = await Teacher.findByIdAndUpdate(id, { ...req.body.data });
    if (typeof req.file !== "undefined") {
      let url = req.file.path;
      let filename = req.file.filename;
      teacher.image = { url, filename };
    }
    await teacher.save();
    req.flash("success", "Profile Update successfully");
    res.redirect(`/teacher/profile`);
  }),
);

// main page //

app.get(
  "/teacher/student/attendance",
  verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }
    let teacherData = await Teacher.findById(req.user._id);

    if (!teacherData) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }

    res.render("teachers/main.ejs", { teacherData });
  }),
);

// show subject class section details

app.get(
  "/show/teacher/class/subject/:id",
   verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    req.session.teacherId = id;
    let datas = await Teacher.findById(id);
    res.render("teachers/showClassSubjectAndothers.ejs", { datas });
  }),
);

// show StudentStatus

app.get(
  "/teacher/show/status",
  verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }
    let classData = await Teacher.findById(req.user._id);

    if (!classData) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }
    res.render("teachers/showStatuslogin.ejs", { classData });
  }),
);

app.post(
  "/teacher/show/status",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    let { data } = req.body;

    if (!data.class || !data.semester || !data.section) {
      req.flash("error", "Class, semester, or section not found ");
      return res.redirect("/teacher/show/status");
    }

    const students = await Student.find({
      class: data.class,
      semester: data.semester,
      section: data.section,
    });

    if (students.length === 0) {
      req.flash("error", "No students datas found");
      return res.redirect("/teacher/show/status");
    }

    // 🔹 TODAY RANGE
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 🔹 TODAY ATTENDANCE ONLY
    let attendance = await Attendance.find({
      date: { $gte: startOfDay, $lte: endOfDay },
    }).populate({
      path: "studentId",
      match: {
        class: data.class,
        semester: data.semester,
        section: data.section,
      },
    });

    attendance = attendance.filter((a) => a.studentId);

    res.render("teachers/showStatus.ejs", {
      students,
      attendance,
      today: new Date(),
    });
  }),
);

app.post(
  "/teacher/show/status/date",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    // 🔹 SESSION FILTERS
    const { data } = req.body || {};

    // ❌ Check if data object or required fields are missing
    if (
      !data ||
      !data.className ||
      !data.semester ||
      !data.section ||
      !data.date
    ) {
      req.flash(
        "error",
        "All fields (Class, Semester, Section, Date) are required!",
      );
      return res.redirect("/teacher/show/status");
    }

    // 🔹 Destructure values safely in a single line
    const { className, semester, section, date } = data;

    // ✅ SAFE UTC DATE PARSING
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      req.flash("error", "Invalid date");
      return res.redirect("/show/status/today/attendance");
    }

    // 🔥 FORCE UTC MIDNIGHT
    selectedDate.setUTCHours(0, 0, 0, 0);

    // 🔹 DAY RANGE (UTC)
    const start = new Date(selectedDate);
    const end = new Date(selectedDate);
    end.setUTCHours(23, 59, 59, 999);

    // 🔹 STUDENTS
    const students = await Student.find({
      class: className,
      semester: semester,
      section: section,
    });

    if (!students.length) {
      req.flash("error", "No students found");
      return res.redirect("/show/status/today/attendance");
    }

    // 🔹 ATTENDANCE (DATE + CLASS FILTER)
    let attendance = await Attendance.find({
      date: { $gte: start, $lte: end },
    }).populate({
      path: "studentId",
      match: {
        class: className,
        semester: semester,
        section: section,
      },
    });

    // 🔹 REMOVE NULL POPULATED
    attendance = attendance.filter((a) => a.studentId);

    // ✅ RENDER SAME PAGE
    res.render("teachers/dateWiseStatus.ejs", {
      students,
      attendance,
      today: selectedDate,
    });
  }),
);

// Add StudentMarks

// 1️⃣ Form Render Route
app.get(
  "/add/student-mark",
  verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    let classData = await Teacher.findById(req.user._id);

    if (!classData) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }

    res.render("teachers/addMarks", { classData });
  }),
);

// // 1. Get Academic Years by Class, Semester & Section
// app.get("/get-exam-academic-years", isLoggedIn, WrapAsync( async (req, res) => {
//   try {
//     const { class: className, semester, section } = req.query;

//     // Find matching configurations
//     const configs = await ExamConfig.find({
//       className: className.toUpperCase().trim(),
//       semester: Number(semester),
//       section: section.toUpperCase().trim()
//     }).distinct("academicYear");

//     res.json(configs);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json([]);
//   }
// }));

// // 2. Get Exam Names by Class, Semester, Section & Academic Year
// app.get("/get-exam-names",  isLoggedIn, WrapAsync( async (req, res) => {
//   try {
//     const { class: className, semester, section, academicYear } = req.query;

//     const config = await ExamConfig.findOne({
//       className: className.toUpperCase().trim(),
//       semester: Number(semester),
//       section: section.toUpperCase().trim(),
//       academicYear: Number(academicYear)
//     });

//     if (!config) return res.json([]);

//     // Extract exam names array
//     const examNames = config.exams.map(e => e.examName);
//     res.json(examNames);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json([]);
//   }
// }));

// // 3. Get MaxMarks & PassingMarks for chosen Exam
// app.get("/get-exam-marks-details",isLoggedIn, WrapAsync(async (req, res) => {
//   try {
//     const { class: className, semester, section, academicYear, examName } = req.query;

//     const config = await ExamConfig.findOne({
//       className: className.toUpperCase().trim(),
//       semester: Number(semester),
//       section: section.toUpperCase().trim(),
//       academicYear: Number(academicYear)
//     });

//     if (!config) return res.status(404).json({});

//     // Find specific sub-exam from exams array
//     const subExam = config.exams.find(e => e.examName === examName.toUpperCase().trim());

//     if (!subExam) return res.status(404).json({});

//     res.json({
//       maxMarks: subExam.maxMarks,
//       passingMarks: subExam.passingMarks
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({});
//   }
// }));

// Helper function to safely escape regex characters
const makeCaseInsensitiveRegex = (text) => {
  if (!text) return "";
  return new RegExp(
    `^${text.trim().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}$`,
    "i",
  );
};

// 1. Get Academic Years
app.get(
  "/get-exam-academic-years",
   verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    try {
      const { class: className, semester, section } = req.query;

      if (!className || !semester || !section) {
        return res.status(400).json([]);
      }

      const parsedSemester = parseInt(semester, 10);
      if (isNaN(parsedSemester)) return res.json([]);

      const configs = await ExamConfig.find({
        className: makeCaseInsensitiveRegex(className),
        semester: parsedSemester,
        section: makeCaseInsensitiveRegex(section),
      }).distinct("academicYear");

      // Sort academic years descending (e.g. 2026, 2025...)
      //     const sortedYears = (configs || []).sort((a, b) => b - a);
      //     return res.json(sortedYears);
      //   } catch (err) {
      //     console.error("Bug Safeguard [/get-exam-academic-years]:", err);
      //     return res.status(500).json([]);
      //   }
      // }));

      const sortedYears = (configs || [])
        .filter(Boolean)
        .map((y) => String(y).trim());

      sortedYears.sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true }),
      );

      return res.json(sortedYears);
    } catch (err) {
      console.error("Bug Safeguard [/get-exam-academic-years]:", err);
      return res.status(500).json([]);
    }
  }),
);

// 2. Get Exam Names
app.get(
  "/get-exam-names",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    try {
      const { class: className, semester, section, academicYear } = req.query;

      if (!className || !semester || !section || !academicYear) {
        return res.status(400).json([]);
      }

      const parsedSemester = parseInt(semester, 10);
      // const parsedYear = parseInt(academicYear, 10);
      const academicYearStr = String(academicYear).trim();

      if (isNaN(parsedSemester) || !academicYearStr) return res.json([]);

      const config = await ExamConfig.findOne({
        className: makeCaseInsensitiveRegex(className),
        semester: parsedSemester,
        section: makeCaseInsensitiveRegex(section),
        academicYear: academicYearStr,
      });

      if (!config || !Array.isArray(config.exams)) {
        return res.json([]);
      }

      const examNames = config.exams.map((e) => e.examName).filter(Boolean);
      return res.json(examNames);
    } catch (err) {
      console.error("Bug Safeguard [/get-exam-names]:", err);
      return res.status(500).json([]);
    }
  }),
);

// 3. Get Max & Passing Marks Details
app.get(
  "/get-exam-marks-details",
  verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    try {
      const {
        class: className,
        semester,
        section,
        academicYear,
        examName,
      } = req.query;

      if (!className || !semester || !section || !academicYear || !examName) {
        return res.status(400).json({ maxMarks: "", passingMarks: "" });
      }

      const parsedSemester = parseInt(semester, 10);
      // const parsedYear = parseInt(academicYear, 10);
      const academicYearStr = String(academicYear).trim();

      if (isNaN(parsedSemester) || !academicYearStr) {
        return res.json({ maxMarks: "", passingMarks: "" });
      }

      const config = await ExamConfig.findOne({
        className: makeCaseInsensitiveRegex(className),
        semester: parsedSemester,
        section: makeCaseInsensitiveRegex(section),
        academicYear: academicYearStr,
      });

      if (!config || !Array.isArray(config.exams)) {
        return res.json({ maxMarks: "", passingMarks: "" });
      }

      const targetExamName = examName.trim().toLowerCase();
      const subExam = config.exams.find(
        (e) => e.examName && e.examName.trim().toLowerCase() === targetExamName,
      );

      if (!subExam) {
        return res.json({ maxMarks: "", passingMarks: "" });
      }

      return res.json({
        maxMarks: subExam.maxMarks ?? "",
        passingMarks: subExam.passingMarks ?? "",
      });
    } catch (err) {
      console.error("Bug Safeguard [/get-exam-marks-details]:", err);
      return res.status(500).json({ maxMarks: "", passingMarks: "" });
    }
  }),
);

// 1️⃣ Setup Student Marks Route
app.post(
  "/add/student/marks-setup",
    verifySession, isLoggedIn,
  validateMarksSetup,
  WrapAsync(async (req, res) => {
    const {
      className,
      semester,
      section,
      subject,
      academicYear,
      examName,
      examType,
      maxMarks,
      passMarks,
      teacherName,
    } = req.body.data;

    // const parsedYear = Number(academicYear);
    const academicYearStr = String(academicYear).trim();
    const parsedSem = Number(semester);
    const parsedMax = Number(maxMarks);
    const parsedPass = Number(passMarks);

    // 🛡️ Extra Guard Check
    if (parsedPass > parsedMax) {
      req.flash("error", "Pass marks cannot be greater than maximum marks.");
      return req.session.save(() => res.redirect("/add/student-mark"));
    }

    // 🛡️ Duplicate Entry Check
    const existingDoc = await Marks.findOne({
      academicYear: academicYearStr,
      className,
      semester: parsedSem,
      section,
      subject,
      examName,
    });
    console.log(subject);

    if (existingDoc) {
      req.flash(
        "error",
        `Marks register already exists for ${examName} (${subject}, Sec-${section}, ${academicYearStr}).`,
      );
      return req.session.save(() => res.redirect("/add/student-mark"));
    }

    // 🛡️ Teacher Access Authorization
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }
    let teacher = await Teacher.findById(req.user._id);

    if (!teacher) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }
    const classObj = teacher?.class?.find((c) => c.className === className);
    const semObj = classObj?.semesters?.find(
      (s) => String(s.semester) === String(semester),
    );
    // const secObj = semObj?.sections?.find((s) => s.section === section);

    // if (!secObj || !(secObj.subjects || []).includes(subject)) {
    //   req.flash("error", "Unauthorized access or subject not assigned to you.");
    //   return req.session.save(() => res.redirect("/add/student-mark"));
    // }

const secObj = semObj?.sections?.find((s) => s.section === section);

    // FIX: Naye Schema [ { subjectId, subjectName } ] aur Purane Schema [ "Maths" ] dono ko safely match karega
    const teacherSubjects =
      secObj?.subjects?.map((sub) =>
        typeof sub === "string" ? sub.trim() : sub?.subjectName?.trim() || ""
      ) || [];

    if (!secObj || !teacherSubjects.includes(subject.trim())) {
      req.flash(
        "error",
        "Unauthorized access or subject not assigned to you."
      );
      return req.session.save(() => res.redirect("/add/student-mark"));
    }
    // Fetch Enrolled Students
    const students = await Student.find({
      class: className,
      semester: parsedSem,
      section,
      "subject.name": subject,
    }).lean();

    if (!students || students.length === 0) {
      req.flash(
        "error",
        `No active students found for ${subject} in section ${section}.`,
      );
      return req.session.save(() => res.redirect("/add/student-mark"));
    }

    res.render("teachers/marksPage.ejs", {
      students,
      metaData: {
        className,
        semester: parsedSem,
        section,
        subject,
        academicYear: academicYearStr,
        examName,
        examType,
        maxMarks: parsedMax,
        passMarks: parsedPass,
        teacherName: teacherName || req.user.name,
      },
    });
  }),
);

// 2️⃣ Save Marks Route (With Atomic Mongoose Session & Transaction)
app.post(
  "/save/student-marks",
    verifySession, isLoggedIn,
  validateSaveMarks,
  WrapAsync(async (req, res) => {
    // 🔴 Step A: Session Layer Initialize
    const session = await mongoose.startSession();

    try {
      // 🟢 Step B: Start Transaction Block
      session.startTransaction();

      const { metaData, studentMarks } = req.body;

      // const numYear = Number(metaData.academicYear);
      const academicYearStr = String(metaData.academicYear).trim();
      const numSem = Number(metaData.semester);
      const numMax = Number(metaData.maxMarks);

      // 🛡️ Transactional Duplicate Check
      const existingEntry = await Marks.findOne({
        academicYear: academicYearStr,
        className: metaData.className,
        semester: numSem,
        section: metaData.section,
        subject: metaData.subject,
        examName: metaData.examName,
      }).session(session);

      if (existingEntry) {
        await session.abortTransaction();
        req.flash("error", "Marks entry already submitted for this exam!");
        return req.session.save(() => res.redirect("/add/student-mark"));
      }

      // Format & Strict Check Student Payload
      const formattedStudents = [];
      const studentKeys = studentMarks ? Object.keys(studentMarks) : [];

      if (studentKeys.length === 0) {
        await session.abortTransaction();
        req.flash("error", "No student marks data received for saving.");
        return req.session.save(() => res.redirect("/add/student-mark"));
      }

      for (const studentId of studentKeys) {
        const item = studentMarks[studentId];
        const isAbsent = item.attendanceStatus === "Absent";
        const obtained = isAbsent ? 0 : Number(item.obtainedMarks || 0);

        // Individual Marks Range Validation
        if (isNaN(obtained) || obtained < 0 || obtained > numMax) {
          await session.abortTransaction();
          req.flash(
            "error",
            `Invalid marks entered for student ${item.studentName || "Unknown"}. (Range: 0 to ${numMax})`,
          );
          return req.session.save(() => res.redirect("/add/student-mark"));
        }

        formattedStudents.push({
          studentId,
          rollNumber: String(item.rollNumber || "").trim(),
          studentName: String(item.studentName || "").trim(),
          fatherName: item.fatherName ? String(item.fatherName).trim() : "",
          obtainedMarks: obtained,
          attendanceStatus: isAbsent ? "Absent" : "Present",
          remarks: item.remarks ? String(item.remarks).trim() : "",
          updatedAt: new Date(),
        });
      }

      // Save Document Bound to Session
      const newMarksDoc = new Marks({
        academicYear: academicYearStr,
        className: metaData.className,
        semester: numSem,
        section: metaData.section,
        subject: metaData.subject,
        examName: metaData.examName,
        examType: metaData.examType,
        maxMarks: numMax,
        passMarks: Number(metaData.passMarks),
        teacherId: req.user._id,
        teacherName: metaData.teacherName,
        status: "OPEN",
        students: formattedStudents,
      });

      // 💾 Document write attached with session
      await newMarksDoc.save({ session });

      // 🏁 Step C: Commit Transaction
      await session.commitTransaction();

      req.flash("success", "Marks sheet saved successfully!");
      return req.session.save(() => res.redirect("/add/student-mark"));
    } catch (err) {
      // Safe Abort Check (In case transaction was already committed or terminated)
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      if (err.code === 11000) {
        req.flash(
          "error",
          "Duplicate submission detected! Document already exists.",
        );
      } else {
        req.flash(
          "error",
          `Server Error during marks submission: ${err.message}`,
        );
      }

      return req.session.save(() => res.redirect("/add/student-mark"));
    } finally {
      // 🔄 Step E: Session Close Mandatory Guard
      session.endSession();
    }
  }),
);

// GET Exams based on filters

// Render View Marks Filter Form Page
app.get(
  "/show/marks/loginPage",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    let classData = await Teacher.findById(req.user._id);

    if (!classData) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }
    res.render("teachers/showMarksLogin.ejs", { classData });
  }),
);

app.get(
  "/get-exams-by-filters",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    const { academicYear, className, semester, section, subject } = req.query;

    const exams = await Marks.distinct("examName", {
      teacherId: req.user._id,
      academicYear: String(academicYear).trim(),
      className,
      semester: Number(semester),
      section,
      subject,
    });

    res.json(exams);
  }),
);

// // GET Unique Academic Years for Logged-in Teacher

// Get Academic Years dynamically from the Marks collection
app.get(
  "/get-teacher-academic-years",
  verifySession,
  isLoggedIn,
  WrapAsync(async (req, res) => {
    try {
      const { class: className, semester, section } = req.query;

      if (!className || !semester || !section) {
        return res.status(400).json([]);
      }

      const parsedSemester = parseInt(semester, 10);
      if (isNaN(parsedSemester)) return res.json([]);

      // Fetch distinct academic years from the 'Marks' database model
      const years = await Marks.find({
        className: makeCaseInsensitiveRegex(className),
        semester: parsedSemester,
        section: makeCaseInsensitiveRegex(section),
      }).distinct("academicYear");

      const sortedYears = (years || [])
        .filter(Boolean)
        .map((y) => String(y).trim());

      // Sort descending (e.g., 2026-2027, 2025-2026 or 2026, 2025)
      sortedYears.sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true })
      );

      return res.json(sortedYears);
    } catch (err) {
      console.error("Bug Safeguard [/get-teacher-academic-years]:", err);
      return res.status(500).json([]);
    }
  })
);
// app.get(
//   "/get-teacher-academic-years",
//     verifySession, isLoggedIn,
//   WrapAsync(async (req, res) => {
//     if (!req.user || !req.user._id) {
//       req.flash("error", "Session expired. Please login again.");
//       return res.redirect("/student/attendance/login");
//     }
//     // Is teacher ne jitne bhi unique academicYears me entries ki hain, unhe fetch karo
//     const years = await Marks.distinct("academicYear", {
//       teacherId: req.user._id,
//     });

//     //     years.sort((a, b) => b - a);

//     //     res.json(years);
//     //   })
//     // );

//     const validYears = years.filter(Boolean).map((y) => String(y).trim());
//     validYears.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

//     res.json(validYears);
//   }),
// );

app.get("/get/marks-subjects",   verifySession, isLoggedIn, WrapAsync(async (req, res) => {
  try {
    const { class: className, semester, section } = req.query;

    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const teacher = await Teacher.findById(req.user._id);
    if (!teacher) return res.json([]);

    const cls = teacher.class.find((c) => c.className === className);
    if (!cls) return res.json([]);

    const sem = cls.semesters.find((s) => s.semester === semester);
    if (!sem) return res.json([]);

    const sec = sem.sections.find((sec) => sec.section === section);
    if (!sec) return res.json([]);

   // 👇 FIX: Naye Object schema [{ subjectId, subjectName }] aur Purane String schema dono ko parse karega
      const rawSubjects = sec.subjects || [];
      const subjects = rawSubjects
        .map((sub) => {
          if (typeof sub === "string") return sub.trim();
          return sub?.subjectName?.trim() || sub?.name?.trim() || "";
        })
        .filter(Boolean); // Blank strings filtering

      res.json(subjects);
    } catch (err) {
      console.error(err);
      res.status(500).json([]);
    }
  })
);

// 1️⃣ VIEW STUDENT MARKS
app.get(
  "/view/student-marks",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    const { academicYear, className, semester, section, subject, examName } =
      req.query;

    if (
      !academicYear ||
      !className ||
      !semester ||
      !section ||
      !subject ||
      !examName
    ) {
      req.flash(
        "error",
        "Please select all parameters to view marks register.",
      );
      return req.session.save(() => res.redirect("/show/marks/loginPage"));
    }

    const formattedExamName = String(examName).trim().toUpperCase();

    const markSheet = await Marks.findOne({
      academicYear: String(academicYear).trim(),
      className,
      semester: Number(semester),
      section,
      subject,
      examName: formattedExamName,
    });

    if (!markSheet) {
      req.flash("error", "No mark register found for selected criteria.");
      return req.session.save(() => res.redirect("/show/marks/loginPage"));
    }

    // Calculating Statistics Safely
    const students = markSheet.students || [];
    const totalStudents = students.length;

    const presentStudents = students.filter(
      (s) => s.attendanceStatus === "Present",
    );
    const presentCount = presentStudents.length;
    const absentCount = totalStudents - presentCount;

    let highest = 0;
    let lowest = 0;
    let average = "0.00";

    if (presentCount > 0) {
      const marksArray = presentStudents.map(
        (s) => Number(s.obtainedMarks) || 0,
      );
      highest = Math.max(...marksArray);
      lowest = Math.min(...marksArray);
      const totalMarks = marksArray.reduce((acc, curr) => acc + curr, 0);
      average = (totalMarks / presentCount).toFixed(2);
    }

    res.render("teachers/viewMarksRegister.ejs", {
      markSheet,
      stats: {
        totalStudents,
        presentCount,
        absentCount,
        highest,
        lowest,
        average,
      },
    });
  }),
);

// 2️⃣ UPDATE STUDENT MARKS
app.post(
  "/update/student-marks/:id",
   verifySession, isLoggedIn,
  validateUpdateMarks,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    const { studentMarks } = req.body;

    const session = await mongoose.startSession();
    let returnUrl = "/show/marks/loginPage"; // Default fallback URL

    try {
      session.startTransaction();

      const markSheet = await Marks.findById(id).session(session);

      if (!markSheet) {
        await session.abortTransaction();
        req.flash("error", "Marksheet record not found.");
        return req.session.save(() => res.redirect("/show/marks/loginPage"));
      }

      // Dynamic exact URL assignment
      returnUrl = `/view/student-marks?academicYear=${markSheet.academicYear}&className=${encodeURIComponent(markSheet.className)}&semester=${markSheet.semester}&section=${encodeURIComponent(markSheet.section)}&subject=${encodeURIComponent(markSheet.subject)}&examName=${encodeURIComponent(markSheet.examName)}`;

      if (markSheet.status === "LOCKED") {
        await session.abortTransaction();
        req.flash(
          "error",
          "❌ Register is LOCKED! You cannot edit student marks.",
        );
        return req.session.save(() => res.redirect(returnUrl));
      }

      for (let studentId in studentMarks) {
        const updatedItem = studentMarks[studentId];
        const targetStudent = markSheet.students.find(
          (s) => String(s.studentId) === String(studentId),
        );

        if (targetStudent) {
          const isAbsent = updatedItem.attendanceStatus === "Absent";
          const newMarks = isAbsent
            ? 0
            : Number(updatedItem.obtainedMarks || 0);

          if (!isAbsent && newMarks > markSheet.maxMarks) {
            await session.abortTransaction();
            req.flash(
              "error",
              `Validation Error: Marks for ${targetStudent.studentName} (${newMarks}) exceed Maximum Marks (${markSheet.maxMarks}).`,
            );
            return req.session.save(() => res.redirect(returnUrl));
          }

          targetStudent.attendanceStatus = isAbsent ? "Absent" : "Present";
          targetStudent.obtainedMarks = newMarks;
          targetStudent.remarks = String(updatedItem.remarks || "").trim();
          targetStudent.updatedAt = new Date();
        }
      }

      await markSheet.save({ session });
      await session.commitTransaction();

      req.flash("success", "Student marks updated successfully!");
      return req.session.save(() => res.redirect(returnUrl));
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      req.flash("error", `Update failed: ${err.message}`);
      return req.session.save(() => res.redirect(returnUrl));
    } finally {
      session.endSession();
    }
  }),
);

// 3️⃣ UPDATE EXAM DETAILS
app.post(
  "/update/exam-details/:id",
   verifySession, isLoggedIn,
  validateUpdateExam,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    const { subject, examName, maxMarks, passMarks, examType } = req.body;

    const formattedExamName = String(examName).trim().toUpperCase();

    const session = await mongoose.startSession();
    let currentReturnUrl = "/show/marks/loginPage"; // Safe scope variable declaration

    try {
      session.startTransaction();

      const markSheet = await Marks.findById(id).session(session);

      if (!markSheet) {
        await session.abortTransaction();
        req.flash("error", "Marksheet record not found.");
        return req.session.save(() => res.redirect("/show/marks/loginPage"));
      }

      // Track URL for safe redirects
      currentReturnUrl = `/view/student-marks?academicYear=${markSheet.academicYear}&className=${encodeURIComponent(markSheet.className)}&semester=${markSheet.semester}&section=${encodeURIComponent(markSheet.section)}&subject=${encodeURIComponent(markSheet.subject)}&examName=${encodeURIComponent(markSheet.examName)}`;

      if (markSheet.status === "LOCKED") {
        await session.abortTransaction();
        req.flash("error", "❌ Register is LOCKED! Cannot edit Exam details.");
        return req.session.save(() => res.redirect(currentReturnUrl));
      }

      const newMax = Number(maxMarks);
      const newPass = Number(passMarks);

      // Verify no student score breaches new maximum marks limit
      const offendingStudent = markSheet.students.find(
        (s) => s.attendanceStatus === "Present" && s.obtainedMarks > newMax,
      );

      if (offendingStudent) {
        await session.abortTransaction();
        req.flash(
          "error",
          `❌ Validation Error: Student "${offendingStudent.studentName}" has ${offendingStudent.obtainedMarks} marks. Lowering Max Marks to ${newMax} is rejected.`,
        );
        return req.session.save(() => res.redirect(currentReturnUrl));
      }

      // Check unique index collision before updating Subject or Exam Name
      if (markSheet.subject !== subject || markSheet.examName !== examName) {
        const existingDoc = await Marks.findOne({
          academicYear: String(markSheet.academicYear).trim(),
          className: markSheet.className,
          semester: markSheet.semester,
          section: markSheet.section,
          subject,
          examName: formattedExamName,
          _id: { $ne: id },
        }).session(session);

        if (existingDoc) {
          await session.abortTransaction();
          req.flash(
            "error",
            `An exam register already exists for "${examName}" in subject "${subject}".`,
          );
          return req.session.save(() => res.redirect(currentReturnUrl));
        }
      }

      // Update fields
      markSheet.subject = subject;
      markSheet.examName = examName;
      markSheet.maxMarks = newMax;
      markSheet.passMarks = newPass;
      markSheet.examType = examType;

      await markSheet.save({ session });
      await session.commitTransaction();

      // Updated View Path after successfully updating metadata
      const newReturnUrl = `/view/student-marks?academicYear=${markSheet.academicYear}&className=${encodeURIComponent(markSheet.className)}&semester=${markSheet.semester}&section=${encodeURIComponent(markSheet.section)}&subject=${encodeURIComponent(markSheet.subject)}&examName=${encodeURIComponent(markSheet.examName)}`;

      req.flash("success", "Exam details updated successfully!");
      return req.session.save(() => res.redirect(newReturnUrl));
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      req.flash("error", `Failed to update exam details: ${err.message}`);
      return req.session.save(() => res.redirect(currentReturnUrl)); // Bug fixed: Safely redirects using current URL
    } finally {
      session.endSession();
    }
  }),
);

// 4️⃣ DELETE MARKS REGISTER
app.post(
  "/delete/marks-register/:id",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    const session = await mongoose.startSession();
    let returnUrl = "/show/marks/loginPage"; // Safe fallback scope

    try {
      session.startTransaction();

      const markSheet = await Marks.findById(id).session(session);

      if (!markSheet) {
        await session.abortTransaction();
        req.flash("error", "Marksheet record not found or already deleted.");
        return req.session.save(() => res.redirect("/show/marks/loginPage"));
      }

      returnUrl = `/view/student-marks?academicYear=${markSheet.academicYear}&className=${encodeURIComponent(markSheet.className)}&semester=${markSheet.semester}&section=${encodeURIComponent(markSheet.section)}&subject=${encodeURIComponent(markSheet.subject)}&examName=${encodeURIComponent(markSheet.examName)}`;

      // Lock Guard Check
      if (markSheet.status === "LOCKED") {
        await session.abortTransaction();
        req.flash(
          "error",
          "❌ Register is LOCKED! Locked marksheets cannot be deleted.",
        );
        return req.session.save(() => res.redirect(returnUrl));
      }

      // Delete document inside session transaction
      await Marks.findByIdAndDelete(id).session(session);

      await session.commitTransaction();
      req.flash("success", "🗑️ Marks register deleted successfully!");
      return req.session.save(() => res.redirect("/show/marks/loginPage"));
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      req.flash("error", `Failed to delete register: ${err.message}`);
      return req.session.save(() => res.redirect(returnUrl));
    } finally {
      session.endSession();
    }
  }),
);

////////////

// take attendance

app.get(
  "/add/student/attendance",
   verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }
    let classData = await Teacher.findById(req.user._id);

    if (!classData) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }

    res.render("teachers/attendanceLogin.ejs", { classData });
  }),
);

app.post(
  "/add/student/attendance",
   verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    const { data } = req.body;

    if (!data) {
      req.flash("error", "Invalid form data submission.");
      return res.redirect("/add/student/attendance");
    }

    const {
      class: className,
      semester,
      section,
      teacherName,
      subject: selectedSubject,
    } = data;

    if (!selectedSubject) {
      req.flash("error", "Please select a subject.");
      return res.redirect("/add/student/attendance");
    }

    req.session.class = className;
    req.session.semester = semester;
    req.session.section = section;

    // 1️⃣ Teacher permissions logic verification

    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    let teacher = await Teacher.findById(req.user._id);

    if (!teacher) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }

    const classObj = teacher.class.find((c) => c.className === className);
    if (!classObj) {
      req.flash("error", "Class not assigned to you");
      return res.redirect("/add/student/attendance");
    }

    const semObj = classObj.semesters.find((s) => s.semester === semester);
    if (!semObj) {
      req.flash("error", "Enter matching semester according to assigned class");
      return res.redirect("/add/student/attendance");
    }

    const secObj = semObj.sections.find((s) => s.section === section);
    if (!secObj) {
      req.flash("error", "Section not assigned to you");
      return res.redirect("/add/student/attendance");
    }

    // const teacherSubjects = secObj.subjects || [];
    // if (!teacherSubjects.includes(selectedSubject)) {
    //   req.flash(
    //     "error",
    //     "This subject is not assigned to you for this section.",
    //   );
    //   return res.redirect("/add/student/attendance");
    // }

 const teacherSubjects = secObj.subjects || [];

   

    const subjectAssigned = teacherSubjects.some(
      (subject) =>
        subject.subjectName === selectedSubject
    );

    if (!subjectAssigned) {
      req.flash(
        "error",
        "This subject is not assigned to you for this section."
      );

      return res.redirect("/add/student/attendance");
    }

    // 2️⃣ Fetch students based on selection
    const students = await Student.find({
      class: className,
      semester,
      section,
      "subject.name": selectedSubject,
    });

    // 3️⃣ Verify and render
    if (students.length === 0) {
      req.flash(
        "error",
        `No students found who have opted for "${selectedSubject}" in this section.`,
      );
      return res.redirect("/add/student/attendance");
    }

    return res.render("teachers/attendancePage.ejs", {
      students,
      selectedSubject,
      teacherName,
      className,
      semester,
      section,
    });
  }),
);

const getTodayDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`; // String "2026-07-29"
};

app.post(
  "/attendance/saveAll",
  verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    const {
      students,
      period,
      unit,
      description,
      subject,
      className,
      semester,
      section,
      teacherName,
    } = req.body;

    // 1. Basic Validation
    if (
      !students ||
      typeof students !== "object" ||
      Object.keys(students).length === 0
    ) {
      req.flash("error", "Invalid or missing student attendance data.");
      return res.redirect("/student/attendance/record");
    }

    const parsedPeriod = Number(period);
    const parsedSemester = String(semester);
    const todayDateStr = getTodayDateString(); // Safe String Date

    // 2. Pre-check A: Check Period Duplicate
    const periodExists = await AttendenceDuplicate.findOne({
      class: className,
      semester: parsedSemester,
      section: section,
      periods: parsedPeriod,
      date: todayDateStr,
    });

    if (periodExists) {
      req.flash(
        "error",
        `⚠️ Attendance for Period ${parsedPeriod} has ALREADY been marked today for ${className} (Sec-${section})!`,
      );
      return res.redirect("/student/attendance/record");
    }

    // 3. Pre-check B: Check Subject Duplicate
    const subjectExists = await AttendenceDuplicate.findOne({
      class: className,
      semester: parsedSemester,
      section: section,
      subject: subject,
      date: todayDateStr,
    });

    if (subjectExists) {
      req.flash(
        "error",
        `⚠️ Attendance for Subject "${subject}" has ALREADY been marked today for ${className} (Sec-${section})!`,
      );
      return res.redirect("/student/attendance/record");
    }

    // 4. Start Transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const attendanceDocs = [];
      const studentEntriesForDuplicate = [];

      for (const [studentId, status] of Object.entries(students)) {
        if (!mongoose.Types.ObjectId.isValid(studentId)) continue;

        // Main Permanent Attendance
        attendanceDocs.push({
          studentId,
          date: new Date(), // Main DB me Timestamp ke saath save kar sakte ho
          status,
          period: parsedPeriod,
          unit,
          description,
          subject,
          teacherName,
          teacherId: req.user?._id || "N/A",
        });

        // Duplicate Document Entry
        studentEntriesForDuplicate.push({
          studentId,
          status,
          unit,
          description,
        });
      }

      if (attendanceDocs.length === 0) {
        await session.abortTransaction();
        session.endSession();
        req.flash(
          "error",
          "No valid student records found. Some thing went wrong!",
        );
        return res.redirect("/student/attendance/record");
      }

      const classLockDocument = {
        date: todayDateStr,
        class: className,
        section: section,
        semester: parsedSemester,
        periods: parsedPeriod,
        subject: subject,
        teacherId: req.user?._id || "N/A",
        teacherName: teacherName,
        students: studentEntriesForDuplicate,
        createdAt: new Date(),
      };

      // Execute Writes
      await Attendance.insertMany(attendanceDocs, { session });
      await AttendenceDuplicate.create([classLockDocument], { session });

      await session.commitTransaction();

      req.flash("success", "✅ Attendance saved successfully!");
      return res.redirect("/student/attendance/record");
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      // 🔥 Handle Double Click / Simultaneous Requests Lock (Error Code 11000)
      if (
        err.code === 11000 ||
        err.writeErrors?.some((e) => e.code === 11000)
      ) {
        req.flash(
          "error",
          "⚠️ Conflict Detected! Ya toh is Period ki ya phir is Subject ki attendance pehle hi submit ho chuki hai.",
        );
        return res.redirect("/student/attendance/record");
      }

      console.error("❌ Error saving attendance:", err);
      req.flash(
        "error",
        "Something went wrong while saving attendance! please try again",
      );
      return res.redirect("/student/attendance/record");
    } finally {
      session.endSession();
    }
  }),
);

// //////////////////////
// app.get(
//   "/search/attendance/student",
//   isLoggedIn,
//   WrapAsync(async (req, res) => {
//     const classes = req.session.class;
//     const semester = req.session.semester;
//     const section = req.session.section;

//     const { name } = req.query;

//     let today = new Date().toISOString().slice(0, 10);

//     // 🔁 Base query (ALL students)
//     let query = {
//       class: classes,
//       semester,
//       section,
//     };

//     // 🔍 If search name provided
//     if (name && name.trim()) {
//       query.name = { $regex: name.trim(), $options: "i" };
//     }

//     let students = await Student.find(query);

//     // ❌ If name was searched but no student found
//     if (name && name.trim() && !students.length) {
//       return res.json({
//         success: false,
//         message: `❌ Student "${name}" not found`,
//       });
//     }

//     // ❌ Safety (no students at all)
//     if (!students.length) {
//       return res.json({
//         success: false,
//         message: "⚠️ No students found in this class",
//       });
//     }

//     // ✅ Prepare response
//     let result = students.map((s) => {
//       let todayStatus = "";
//       if (s.attendance?.length) {
//         let record = s.attendance.find(
//           (a) => a.date?.toISOString().slice(0, 10) === today,
//         );
//         if (record) todayStatus = record.status || "";
//       }

//       return {
//         _id: s._id,
//         rollNo: s.rollNo,
//         name: s.name,
//         fatherName: s.fatherName,
//         attendanceToday: todayStatus,
//       };
//     });

//     res.json({
//       success: true,
//       data: result,
//     });
//   }),
// );

// update attendance

app.get(
  "/update/student/attendance",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    let classData = await Teacher.findById(req.user._id);

    if (!classData) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }

    res.render("teachers/updateAttenLogin.ejs", { classData });
  }),
);

// get semester

app.get("/get-semesters",   verifySession, isLoggedIn, WrapAsync( async (req, res) => {
  try {
    const { class: className } = req.query;
    if (!className) return res.json([]);

    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const teacher = await Teacher.findById(req.user._id);
    if (!teacher || !teacher.class?.length) return res.json([]);

    const cls = teacher.class.find(
      (c) => c.className.toLowerCase() === className.toLowerCase(),
    );
    if (!cls || !cls.semesters?.length) return res.json([]);

    const semesters = cls.semesters.map((s) => s.semester);
    res.json(semesters);
  } catch (err) {
    console.error("SEMESTER AJAX ERROR:", err);
    res.status(500).json([]);
  }
}));

// find section according class and semeater wise

// ✅ Route: Get Sections by Class + Semester
app.get("/get-sections",  verifySession, isLoggedIn,WrapAsync( async (req, res) => {
  try {
    const { class: className, semester } = req.query;

    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const teacher = await Teacher.findById(req.user._id);
    if (!teacher) return res.json([]);

    const cls = teacher.class.find((c) => c.className === className);
    if (!cls) return res.json([]);

    const sem = cls.semesters.find((s) => s.semester === semester);
    if (!sem) return res.json([]);

    const sections = sem.sections.map((sec) => sec.section);
    res.json(sections);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
}));

// find subject according class and semeater and section  wise

// ✅ Route: Get Subjects by Class + Semester + Section
app.get("/get-subjects",   verifySession, isLoggedIn, WrapAsync(async (req, res) => {
  try {
    const { class: className, semester, section } = req.query;

    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const teacher = await Teacher.findById(req.user._id);
    if (!teacher) return res.json([]);

    const cls = teacher.class.find((c) => c.className === className);
    if (!cls) return res.json([]);

    const sem = cls.semesters.find((s) => s.semester === semester);
    if (!sem) return res.json([]);

    const sec = sem.sections.find((sec) => sec.section === section);
    if (!sec) return res.json([]);

    // 👇 YAHAN SUBJECTS RETURN HO RAHE HAIN
    const subjects = sec.subjects || [];
    res.json(subjects);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
}));



/* =========================================================
   1️⃣ GET/FETCH ATTENDANCE DATA FOR UPDATE PAGE
========================================================== */
app.post(
  "/update/student/attendance",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    const { data } = req.body;
    const { class: className, semester, section, subject, teacherName } = data;
    

    // Normalizer helper
    const normalize = (str) =>
      str?.toString().trim().toLowerCase().replace(/\s+/g, " ");

    const cleanClass = className.trim();
    const cleanSemester = semester.trim();
    const cleanSection = section.trim();
    const cleanSubject = subject.trim();
    console.log(cleanSubject)

    req.session.class = cleanClass;
    req.session.semester = cleanSemester;
    req.session.section = cleanSection;
    // req.session.subject = cleanSubject;

    // ===== Teacher authorization check =====

    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }
    const teacher = await Teacher.findById(req.user._id);
    if (!teacher) {
      req.flash("error", "Teacher not found");
      return res.redirect("/update/student/attendance");
    }

    const classObj = teacher.class?.find(
      (c) => normalize(c.className) === normalize(cleanClass),
    );
    const semObj = classObj?.semesters?.find(
      (s) => normalize(s.semester) === normalize(cleanSemester),
    );
    const secObj = semObj?.sections?.find(
      (s) => normalize(s.section) === normalize(cleanSection),
    );

    if (!classObj || !semObj || !secObj) {
      req.flash("error", "Class / Semester / Section not assigned to you");
      return res.redirect("/update/student/attendance");
    }

    // ===== Find attendance record in Class-Level Duplicate Collection =====
    const todayDateStr = getTodayDateString();

    const record = await AttendenceDuplicate.findOne({
      class: cleanClass,
      semester: cleanSemester,
      section: cleanSection,
      subject: cleanSubject,
      date: todayDateStr,
    });

    if (!record) {
      req.flash("error", "No attendance record found for today to update");
      return res.redirect("/update/student/attendance");
    }

    // Check 24 hour limit (Creation check)
    const now = new Date();
    const hoursDiff = (now - new Date(record.createdAt)) / (1000 * 60 * 60);

    if (hoursDiff > 24) {
      req.flash("error", "Update allowed only within 24 hours");
      return res.redirect("/update/student/attendance");
    }

    const currentAttendance = {
      periods: record.periods,
      unit: record.students[0]?.unit || "",
      description: record.students[0]?.description || "",
      date: record.createdAt,
    };

    // ===== Fetch students =====
    const students = await Student.find({
      class: cleanClass,
      semester: cleanSemester,
      section: cleanSection,
      "subject.name": cleanSubject,
    });

    if (!students.length) {
      req.flash("error", "No students found");
      return res.redirect("/update/student/attendance");
    }

    // ===== Build status map =====
    const statusMap = {};
    for (const studentEntry of record.students) {
      statusMap[studentEntry.studentId.toString()] =
        studentEntry.status || "Not marked";
    }

    const studentsWithStatus = students.map((stu) => ({
      ...stu.toObject(),
      attendanceToday: statusMap[stu._id.toString()] || "Not marked",
    }));

    // ===== Subject permission check =====

    const studentSubjects = students.flatMap((s) =>
      s.subject.map((sub) => {
        if (typeof sub === "string") return sub.trim();
        return sub?.name?.trim() || sub?.subjectName?.trim() || "";
      })
    );

    // FIX HERE: Objects array [ { subjectId, subjectName } ] aur String array dono ko handle karta hai
    const teacherSubjects =
      secObj.subjects?.map((sub) => {
        if (typeof sub === "string") return sub.trim();
        return sub?.subjectName?.trim() || sub?.name?.trim() || "";
      }) || [];

    const commonSubjects = teacherSubjects.filter((sub) =>
      studentSubjects.includes(sub)
    );

    if (!commonSubjects.includes(cleanSubject)) {
      req.flash("error", "You are not allowed for this subject");
      return res.redirect("/update/student/attendance");
    }
    // const studentSubjects = students.flatMap((s) =>
    //   s.subject.map((sub) =>
    //     typeof sub === "string" ? sub.trim() : sub.name.trim(),
    //   ),
    // );

    // const teacherSubjects = secObj.subjects?.map((sub) => sub.trim()) || [];
    // const commonSubjects = teacherSubjects.filter((sub) =>
    //   studentSubjects.includes(sub),
    // );

    // if (!commonSubjects.includes(cleanSubject)) {
    //   req.flash("error", "You are not allowed for this subject");
    //   return res.redirect("/update/student/attendance");
    // }

    // ===== Render Update Form =====
    res.render("teachers/updateAttenPage.ejs", {
      students: studentsWithStatus,
      subject: cleanSubject,
      cleanClass,
      cleanSection,
      cleanSemester,
      teacherName,
      commonSubjects,
      currentAttendance,
    });
  }),
);

/* =========================================================
   2️⃣ SAVE UPDATED ATTENDANCE SUBMISSION
========================================================== */
app.post(
  "/attendance/updateAll",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    const {
      students,
      period,
      unit,
      description,
      subject,
      className,
      semester,
      section,
      teacherName,
    } = req.body;

    if (
      !students ||
      typeof students !== "object" ||
      Object.keys(students).length === 0
    ) {
      req.flash(
        "error",
        "Invalid or missing student attendance data.Please try again!",
      );
      return res.redirect("/student/attendance/record");
    }

    const parsedPeriod = Number(period);
    const parsedSemester = String(semester);
    const todayDateStr = getTodayDateString();
    const now = new Date();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // MongoDB Session Start for Transaction Locks
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const updatedStudentEntries = [];
      const bulkMainAttendanceOps = [];

      for (const [id, status] of Object.entries(students)) {
        if (!mongoose.Types.ObjectId.isValid(id)) continue;

        // 1. Array element for AttendenceDuplicate
        updatedStudentEntries.push({
          studentId: id,
          status,
          unit,
          description,
        });

        // 2. Upsert/Update Operation for Permanent Attendance Collection
        bulkMainAttendanceOps.push({
          updateOne: {
            filter: {
              studentId: id,
              period: parsedPeriod,
              subject: subject,
              date: { $gte: todayStart, $lte: todayEnd },
            },
            update: {
              $set: {
                status,
                unit,
                description,
                teacherName,
                teacherId: req.user?._id || "N/A",
                updatedAt: now,
              },
              $setOnInsert: {
                studentId: id,
                period: parsedPeriod,
                subject,
                date: now,
                createdAt: now,
              },
            },
            upsert: true,
          },
        });
      }

      // 🔹 UPDATE / OVERWRITE ATTENDENCE DUPLICATE RECORD (Class-Level)
      await AttendenceDuplicate.findOneAndUpdate(
        {
          class: className,
          semester: parsedSemester,
          section: section,
          periods: parsedPeriod,
          subject: subject,
          date: todayDateStr,
        },
        {
          $set: {
              teacherId: req.user?._id || "N/A",
            teacherName: teacherName,
            students: updatedStudentEntries,
            createdAt: now, // Reset TTL lock timer
          },
        },
        { upsert: true, session },
      );

      // 🔹 BULK WRITE TO MAIN ATTENDANCE COLLECTION
      if (bulkMainAttendanceOps.length > 0) {
        await Attendance.bulkWrite(bulkMainAttendanceOps, { session });
      }

      // Commit transaction
      await session.commitTransaction();

      req.flash(
        "success",
        `✅ Attendance updated successfully for ${updatedStudentEntries.length} students!`,
      );
      return res.redirect("/student/attendance/record");
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      // 🔥 Catch Concurrent Request Conflicts (Race Conditions)
      if (
        err.code === 11000 ||
        err.writeErrors?.some((e) => e.code === 11000)
      ) {
        req.flash(
          "error",
          "⚠️ Conflict Detected! Submissions overlapping or period locked.please try again",
        );
        return res.redirect("/student/attendance/record");
      }

      console.error("❌ Error updating attendance:", err);
      req.flash(
        "error",
        "Something went wrong while updating attendance!please try again",
      );
      return res.redirect("/student/attendance/record");
    } finally {
      session.endSession();
    }
  }),
);

// search Student for Attendance

app.get(
  "/search/attendance/student",
   verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    const classes = req.session.class;
    const semester = req.session.semester;
    const section = req.session.section;

    const { name } = req.query;

    let today = new Date().toISOString().slice(0, 10);

    // 🔁 Base query (ALL students)
    let query = {
      class: classes,
      semester,
      section,
    };

    // 🔍 If search name provided
    if (name && name.trim()) {
      query.name = { $regex: name.trim(), $options: "i" };
    }

    let students = await Student.find(query);

    // ❌ If name was searched but no student found
    if (name && name.trim() && !students.length) {
      return res.json({
        success: false,
        message: `❌ Student "${name}" not found`,
      });
    }

    // ❌ Safety (no students at all)
    if (!students.length) {
      return res.json({
        success: false,
        message: "⚠️ No students found in this class",
      });
    }

    // ✅ Prepare response
    let result = students.map((s) => {
      let todayStatus = "";
      if (s.attendance?.length) {
        let record = s.attendance.find(
          (a) => a.date?.toISOString().slice(0, 10) === today,
        );
        if (record) todayStatus = record.status || "";
      }

      return {
        _id: s._id,
        rollNo: s.rollNo,
        name: s.name,
        fatherName: s.fatherName,
        attendanceToday: todayStatus,
      };
    });

    res.json({
      success: true,
      data: result,
    });
  }),
);

// show attendance route

app.get(
  "/student/attendance/record",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    const classes = req.session.class;
    const semester = req.session.semester;
    const section = req.session.section;

    if (!classes || !semester || !section) {
      req.flash("error", "Class, semester, or section not found in session");
      return res.redirect("/add/student/attendance");
    }

    // 🔹 Students
    const students = await Student.find({
      class: classes,
      semester: semester,
      section: section,
    });

    if (!students.length) {
      req.flash("error", "No students found");
      return res.redirect("/add/student/attendance");
    }

    // 🔹 TODAY RANGE
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 🔹 TODAY ATTENDANCE ONLY
    let attendance = await Attendance.find({
      date: { $gte: startOfDay, $lte: endOfDay },
    }).populate({
      path: "studentId",
      match: {
        class: classes,
        semester: semester,
        section: section,
      },
    });

    attendance = attendance.filter((a) => a.studentId);

    // req.session.class = null;
    // req.session.semester = null;
    // req.session.section = null;

    res.render("teachers/showAttendance.ejs", {
      students,
      attendance,
      today: new Date(),
    });
  }),
);

// show teacher time table

app.get(
  "/teacher/show/time/table",
   verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }
    let classData = await Teacher.findById(req.user._id);

    if (!classData) {
      req.flash("error", "Teacher not found");
      return res.redirect("/student/attendance/login");
    }

    res.render("teachers/timeTableLogin.ejs", { classData });
  }),
);

// ==========================================
// 1. POST: SHOW CLASS-WISE TIME TABLE FOR TEACHER
// ==========================================
app.post(
  "/teacher/show/time/table",
   verifySession, isLoggedIn, // Aapka authenticating middleware
  WrapAsync(async (req, res) => {
    // Form submission se extracted parameters parsing
    const { class: className, semester, section } = req.body.data || {};

    if (!className || !semester || !section) {
      req.flash("error", "Invalid Search Parameters Supplied.");
      return res.redirect("/teacher/show/time/table"); // Ya jahan aapka form template located hai
    }

   const cleanCourseForHod = (fullCourseName) => {
      if (!fullCourseName) return "";
      return fullCourseName
        .replace(/\s*[-_]?\s*(?:1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH)\s*(?:YEAR)?\s*$/i, "")
        .replace(/\s*[-_]?\s*(?:YEAR|SEM|SEMESTER)\s*\d+\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    };

    const baseCourseName = cleanCourseForHod(className);

    // 2. Parallel Database Queries (Fast Performance)
    const [scheduleData, classInchargeDoc, hodDoc] = await Promise.all([
      TimeTable.find({ className, semester, section }),
      ClassIncharge.findOne({ className, semester, sectionName:section }).populate("teacher", "name"),
      Hod.findOne({ courseName: baseCourseName }).populate("teacher", "name")
    ]);
    

    // 3. Extract Incharge and HOD details safely
    const classIncharge = classInchargeDoc && classInchargeDoc.teacher 
      ? classInchargeDoc.teacher.name 
      : "Not Assigned";

    const hod = hodDoc && hodDoc.teacher 
      ? hodDoc.teacher.name 
      : "Not Assigned";
    // const scheduleData = await TimeTable.find({ className, semester, section });

    let groupedTimetable = {};
    let periods = [];

    scheduleData.forEach((slot) => {
      if (!groupedTimetable[slot.day_of_week]) {
        groupedTimetable[slot.day_of_week] = {};
      }

      groupedTimetable[slot.day_of_week][slot.lecture_number] = {
        subject: slot.subject_name || "-",
        teacher: slot.teacher_name || "N/A",
      };

      if (!periods.some((p) => p.id === slot.lecture_number)) {
        periods.push({
          id: slot.lecture_number,
          timeStr: slot.start_time,
          displayTime: `${slot.start_time} - ${slot.end_time}`,
        });
      }
    });

    // Helper Utility function to sort time slots
    const convertTimeToMinutes = (timeStr) => {
      if (!timeStr) return 0;
      let [time, modifier] = timeStr.trim().split(" ");
      let [hours, minutes] = time.split(":").map(Number);
      if (modifier) {
        const upperModifier = modifier.toUpperCase();
        if (upperModifier === "PM" && hours < 12) hours += 12;
        if (upperModifier === "AM" && hours === 12) hours = 0;
      } else if (hours >= 1 && hours <= 6) {
        hours += 12;
      }
      return hours * 60 + minutes;
    };

    periods.sort(
      (a, b) =>
        convertTimeToMinutes(a.timeStr) - convertTimeToMinutes(b.timeStr),
    );

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayNames = {
      Mon: "Mon",
      Tue: "Tue",
      Wed: "Wed",
      Thu: "Thu",
      Fri: "Fri",
      Sat: "Sat",
    };

    // 🔥 STALWART STUDENT-LIKE VALIDATION LOGIC ENGINE
    let isComplete = true;
    let messageType = "none";

    if (periods.length === 0) {
      isComplete = false;
      messageType = "missing";
    } else {
      for (let day of days) {
        for (let period of periods) {
          if (!groupedTimetable[day] || !groupedTimetable[day][period.id]) {
            isComplete = false;
            messageType = "incomplete";
            break;
          }
        }
        if (!isComplete) break;
      }
    }

    res.render("teachers/showClassTimetable.ejs", {
      className,
      semester,
      section,
      groupedTimetable,
      periods,
      days,
      dayNames,
      isComplete,
      messageType,
      classIncharge, // 👈 Send Incharge Name
      hod
    });
  }),
);

// ==========================================
// 2. GET: TEACHER'S OWN PERSONAL SCHEDULE (UPDATED WITH TEACHER ID)
// ==========================================
app.get(
  "/teacher/my-schedule",
   verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    // 1. Logged-in user ke account context se MongoDB Document search karenge
    if (!req.user || !req.user._id) {
      req.flash("error", "Authentication context missing. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    // Teacher collection se exact data nikalenge taaki name tracking complete safe rahe
    let teacherDoc = await Teacher.findById(req.user._id);

    if (!teacherDoc) {
      req.flash("error", "Teacher record not found in database.");
      return res.redirect("/student/attendance/login");
    }

    // Database schema variables matching string setup
    const teacherName = teacherDoc.name;

    // 2. Timetable pool se query run karenge using validated teacher name string reference
    const scheduleData = await TimeTable.find({ teacher_name: teacherName });

    let groupedTimetable = {};
    let periods = [];

    scheduleData.forEach((slot) => {
      if (!groupedTimetable[slot.day_of_week]) {
        groupedTimetable[slot.day_of_week] = {};
      }

      groupedTimetable[slot.day_of_week][slot.lecture_number] = {
        subject: slot.subject_name,
        targetClass: `${slot.className} (Sem-${slot.semester}, Sec-${slot.section})`,
      };

      if (!periods.some((p) => p.id === slot.lecture_number)) {
        periods.push({
          id: slot.lecture_number,
          timeStr: slot.start_time,
          displayTime: `${slot.start_time} - ${slot.end_time}`,
        });
      }
    });

    const convertTimeToMinutes = (timeStr) => {
      if (!timeStr) return 0;
      let [time, modifier] = timeStr.trim().split(" ");
      let [hours, minutes] = time.split(":").map(Number);
      if (modifier) {
        const upperModifier = modifier.toUpperCase();
        if (upperModifier === "PM" && hours < 12) hours += 12;
        if (upperModifier === "AM" && hours === 12) hours = 0;
      } else if (hours >= 1 && hours <= 6) {
        hours += 12;
      }
      return hours * 60 + minutes;
    };

    periods.sort(
      (a, b) =>
        convertTimeToMinutes(a.timeStr) - convertTimeToMinutes(b.timeStr),
    );

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayNames = {
      Mon: "Monday",
      Tue: "Tuesday",
      Wed: "Wednesday",
      Thu: "Thursday",
      Fri: "Friday",
      Sat: "Saturday",
    };

    let hasSchedule = periods.length > 0;

    res.render("teachers/myPersonalSchedule.ejs", {
      teacherName, // Header title block display metadata tracking
      groupedTimetable,
      periods,
      days,
      dayNames,
      hasSchedule,
    });
  }),
);

// logout teacher

// app.get("/logout", isLoggedIn, (req, res, next) => {
// req.logout((err) => {
//   if (err) {
//     return next(err);
//   }

//     req.flash("success", "You are logged out");
//     res.redirect("/student/attendance/login");
//   });
// });

app.get("/logout", verifySession, isLoggedIn, (req, res, next) => {
  // 1. Passport Auth Clear Karein
  req.logout((err) => {
    if (err) {
      return next(err);
    }

    // 2. Pure Session Object ko memory/DB se Delete Karein
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        console.error("Teacher Logout Session Destroy Error:", destroyErr);
        return next(destroyErr);
      }

      // 3. Browser Se Cookie Clear Karein (default name 'connect.sid' hota hai)
      res.clearCookie("connect.sid");

      // 4. Redirect
      return res.redirect("/student/attendance/login");
    });
  });
});

////////////////////////// teacher folder closed/////////////////////////////////////////////////

//////////////////////////// student folder start//////////////////////////////////////////////



// update Password

// app.get("/student/update/password", (req, res) => {
//   res.render("users/updatePassword.ejs");
// });

// app.post(
//   "/student/update/password",
//   WrapAsync(async (req, res) => {
//     const rollNo = req.session.rollNo; // ✅ FIXED
//     const { password } = req.body.data; // ✅ FIXED

//     if (!rollNo) {
//       req.flash("error", "Session expired. Please login again");
//       return res.redirect("/student/attendance/login");
//     }

//     // 🔐 PASSWORD LENGTH VALIDATION
//     if (!password || password.length < 8) {
//       req.flash("error", "Password must be at least 8 characters long");
//       return res.redirect("/student/update/password");
//     }

//     const student = await Student.findOne({ rollNo: parseInt(rollNo) });

//     if (!student) {
//       req.flash("error", "Student not found");
//       return res.redirect("/student/attendance/login");
//     }

//     if (student.status === "Blocked") {
//       req.session.rollNo = null;
//       req.flash("error", "Your account is blocked. Please contact admin.");
//       return res.redirect("/student/attendance/login");
//     }

//     student.password = password;
//     student.check = "update";
//     student.passwordChangedAt = new Date(); // 👈 GUARANTEED TIMESTAMP UPDATE
//     await student.save();
//     req.session.rollNo = null;
//     req.flash("success", "Update success, Login again with new password");
//     return res.redirect("/student/attendance/login");
//   }),
// );

// UPDATE PASSWORD

// GET Route - Form render karne ke liye (Session check added for security)
app.get("/student/update/password", (req, res) => {
  if (!req.session.rollNo && !req.session.userId) {
    req.flash("error", "Unauthorized access. Please login first.");
    return res.redirect("/student/attendance/login");
  }
  res.render("users/updatePassword.ejs");
});

// POST Route - Naya password save karne ke liye
app.post(
  "/student/update/password",
  WrapAsync(async (req, res) => {
    // 🔴 1. ROLL NO / USER ID FETCH
    const rollNo = req.session.rollNo;
    const { password } = req.body?.data || req.body || {}; // Safe extraction

    if (!rollNo) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    // 🔴 2. PASSWORD STRENGTH VALIDATION
    const hasNumberOrSpecial = /[\d!@#$%^&*(),.?":{}|<>_]/.test(password);
    if (!password || password.length < 8 || !hasNumberOrSpecial) {
      req.flash(
        "error",
        "Password must be at least 8 characters long and contain at least one number or special character.",
      );
      return res.redirect("/student/update/password");
    }

    // 🔴 3. STUDENT FETCH FROM DB
    const student = await Student.findOne({ rollNo: parseInt(rollNo, 10) });

    if (!student) {
      req.session.destroy();
      req.flash("error", "Student account not found.");
      return res.redirect("/student/attendance/login");
    }

    // 🔴 4. BLOCKED ACCOUNT CHECK
    if (student.status === "Blocked") {
      req.session.destroy();
      req.flash("error", "Your account is blocked. Please contact admin.");
      return res.redirect("/student/attendance/login");
    }

    // 🔴 5. SAVE NEW PASSWORD & TIMESTAMP
    student.password = password; // Mongoose pre('save') hook bcrypt hash karega
    student.check = "update"; // Mark status as updated
    student.passwordChangedAt = new Date(); // 👈 Multi-Device Logout Sync Timestamp

    await student.save();

    // 🔴 6. COMPLETE SESSION WIPE-OUT (For Fresh Login)
    delete req.session.rollNo;
    delete req.session.studentId;
    delete req.session.userId;
    delete req.session.otpVerified;

    // 🔴 7. FORCE SAVE SESSION BEFORE REDIRECT
    return req.session.save((err) => {
      if (err) console.error("Session Save Error:", err);
      req.flash(
        "success",
        "Password updated successfully! Please login again with your new password.",
      );
      return res.redirect("/student/attendance/login");
    });
  }),
);

//  student main page

app.get(
  "/student/attendance",
  verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const studentId = req.session.studentId || req.session.userId;

    if (!studentId) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const student = await Student.findById(studentId);

    if (!student) {
      req.flash("error", "Something went wrong");
      return res.redirect("/student/attendance/login");
    }
    res.render("students/main.ejs", { student });
  }),
);

// student profile

app.get(
  "/profile",
  verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const studentId = req.session.studentId || req.session.userId;

    if (!studentId) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const student = await Student.findById(studentId);

    if (!student) {
      req.flash("error", "Something went wrong");
      return res.redirect("/student/attendance/login");
    }
    res.render("students/profile.ejs", { student });
  }),
);

// edit profile
app.get(
  "/profile/edit/:id",
  verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let data = await Student.findById(id);
    res.render("students/editProfile.ejs", { data, id });
  }),
);

app.put(
  "/profile/edit/:id",
  verifySession, isStudentVerified,
  upload.single("data[image]"),
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let student = await Student.findByIdAndUpdate(id, { ...req.body.data });
    if (typeof req.file !== "undefined") {
      let url = req.file.path;
      let filename = req.file.filename;
      student.image = { url, filename };
    }
    await student.save();
    req.flash("success", "Profile Update successfully");
    res.redirect(`/profile`);
  }),
);

// subject check

app.get(
  "/student/attendance/subject/check",
   verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const studentId = req.session.studentId || req.session.userId;

    if (!studentId) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const student = await Student.findById(studentId);

    if (!student) {
      req.flash("error", "Something went wrong");
      return res.redirect("/student/attendance/login");
    }
    res.render("students/checkSubject.ejs", { student });
  }),
);

// Add feed

app.get(
  "/student/add/feed",
   verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const studentId = req.session.studentId || req.session.userId;

    if (!studentId) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const student = await Student.findById(studentId);

    if (!student) {
      req.flash("error", "Something went wrong");
      return res.redirect("/student/attendance/login");
    }
    res.render("students/feedPage.ejs", { student });
  }),
);

app.post(
  "/student/add/feed/:studentId",
  verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const { content } = req.body.data || {};
    if (!content || content.trim() === "") {
      req.flash("error", "Feed cannot be empty");
      return res.redirect("/student/add/feed");
    }

    const studentId = req.params.studentId;

    // Optional: verify if student exists
    const student = await Student.findById(studentId);
    if (!student) {
      req.flash("error", "Student not found");
      return res.redirect("/student/add/feed");
    }

    const newFeed = new Feed({
      content: content.trim(),
      studentId: student._id, // Correct reference
    });

    await newFeed.save();

    req.flash("success", "Feed added successfully");
    res.redirect("/student/add/feed");
  }),
);

// show feed

app.get(
  "/student/show/feed",
   verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const studentId = req.session.studentId || req.session.userId;

    if (!studentId) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const student = await Student.findById(studentId);

    if (!student) {
      req.flash("error", "Student not found");
      return res.redirect("/student/attendance/login");
    }

    const page = parseInt(req.query.page) || 1;
    const limit = 10;

    const totalFeeds = await Feed.countDocuments({ studentId: student._id });

    const feeds = await Feed.find({ studentId: student._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const totalPages = Math.ceil(totalFeeds / limit);

    res.render("students/showFeed.ejs", { feeds, page, totalPages });
  }),
);

// delete feed

app.delete(
  "/student/feed/delete/:id",
   verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    await Feed.findByIdAndDelete(id);
    req.flash("success", "Delete successfully");
    res.redirect("/student/show/feed");
  }),
);

// show status//

app.get(
  "/student/attendance/status/check",
   verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const studentId = req.session.studentId || req.session.userId;

    if (!studentId) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const student = await Student.findById(studentId);

    if (!student) {
      req.flash("error", "Student record not found.");
      return res.redirect("/student/attendance/login");
    }

    // IMPORTANT: Student ki _id ko session mein save kar rahe hain
    // taaki naya client-side filter API engine ise call kar sake
    // req.session.studentId = student._id;

    // Naya high-performance status view render karein
    res.render("students/showStatus.ejs", { student });
  }),
);

app.get(
  "/student/attendance/api/v2",
   verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const studentId = req.session.studentId || req.session.userId;
    let rollNo = req.session.rollNo;

    if (!rollNo || !studentId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized access" });
    }

    let { filter, from, to, academicYear, page } = req.query;
    let mainQuery = { studentId };

    // 1️⃣ Academic Year Filter Handling
    if (academicYear) {
      mainQuery.class = {
        $regex: `${academicYear}(st|nd|rd|th)?\\s+year`,
        $options: "i",
      };
    }

    // 2️⃣ Dynamic Date Calculations Pipeline (UTC Safe & Highly Accurate)
    const now = new Date();
    let isFilterActive = false;

    if (filter === "today") {
      isFilterActive = true;
      const start = new Date(now.setHours(0, 0, 0, 0));
      const end = new Date(now.setHours(23, 59, 59, 999));
      mainQuery.date = { $gte: start, $lte: end };
    } else if (filter === "weekly") {
      isFilterActive = true;
      const currentDay = now.getDay();
      const startOfWeek = new Date(now.setDate(now.getDate() - currentDay));
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(now.setDate(startOfWeek.getDate() + 6));
      endOfWeek.setHours(23, 59, 59, 999);
      mainQuery.date = { $gte: startOfWeek, $lte: endOfWeek };
    } else if (filter === "monthly") {
      isFilterActive = true;
      const startOfMonth = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );
      const endOfMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
      mainQuery.date = { $gte: startOfMonth, $lte: endOfMonth };
    } else if (filter === "custom" && from && to) {
      isFilterActive = true;
      const fromDate = parseIndianDate(from);
      fromDate.setHours(0, 0, 0, 0);

      const toDate = parseIndianDate(to);
      toDate.setHours(23, 59, 59, 999);

      mainQuery.date = { $gte: fromDate, $lte: toDate };
    }

    if (academicYear) {
      isFilterActive = true;
    }

    // 3️⃣ Global Summary Aggregation Engine (Hamesha real-time analytics bar ko perfect rakhega)
    const allMatchingLogs =
      await Attendance.find(mainQuery).select("date status");

    const dayMap = new Map();
    let presentPeriodsCount = 0;
    let totalPeriodsCount = allMatchingLogs.length;

    allMatchingLogs.forEach((a) => {
      const day = new Date(a.date).toISOString().split("T")[0];
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day).push(a.status);
      if (a.status === "Present") presentPeriodsCount++;
    });

    let totalDays = dayMap.size;
    let presentDays = 0;
    dayMap.forEach((statuses) => {
      if (statuses.includes("Present")) presentDays++;
    });
    let absentDays = totalDays - presentDays;

    const globalSummary = {
      totalDays,
      presentDays,
      absentDays,
      slotsTotal: totalPeriodsCount,
      slotsPresent: presentPeriodsCount,
    };

    // 4️⃣ Paginated Table Data Logic (100 rows per page limit)
    const perPage = 100;
    const currentPage = parseInt(page) || 1;
    const totalRecords = totalPeriodsCount;
    const totalPages = Math.ceil(totalRecords / perPage) || 1;
    const skipEntries = (currentPage - 1) * perPage;

    const attendanceData = await Attendance.find(mainQuery)
      .sort({ date: 1, period: 1 })
      .skip(skipEntries)
      .limit(perPage);

    return res.json({
      success: true,
      data: attendanceData,
      summary: globalSummary,
      pagination: {
        totalRecords,
        totalPages,
        currentPage,
        perPage,
        isFilterActive,
      },
    });
  }),
);

app.get(
  "/student/show/time/table",
 verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    const studentId = req.session.studentId || req.session.userId;

    if (!studentId) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const student = await Student.findById(studentId);

    if (!student) {
      req.flash("error", "Student record not found.");
      return res.redirect("/student/attendance/login");
    }

    const className = student.class;
    const semester = student.semester;
    const section = student.section;


     const cleanCourseForHod = (fullCourseName) => {
      if (!fullCourseName) return "";
      return fullCourseName
        .replace(/\s*[-_]?\s*(?:1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH)\s*(?:YEAR)?\s*$/i, "")
        .replace(/\s*[-_]?\s*(?:YEAR|SEM|SEMESTER)\s*\d+\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    };

    const baseCourseName = cleanCourseForHod(className);

    // 2. Parallel Database Queries (Fast Performance)
    const [scheduleData, classInchargeDoc, hodDoc] = await Promise.all([
      TimeTable.find({ className, semester, section }),
      ClassIncharge.findOne({ className, semester, sectionName:section }).populate("teacher", "name"),
      Hod.findOne({ courseName: baseCourseName }).populate("teacher", "name")
    ]);
     

    // 3. Extract Incharge and HOD details safely
    const classIncharge = classInchargeDoc && classInchargeDoc.teacher 
      ? classInchargeDoc.teacher.name 
      : "Not Assigned";

    const hod = hodDoc && hodDoc.teacher 
      ? hodDoc.teacher.name 
      : "Not Assigned";

    // const scheduleData = await TimeTable.find({ className, semester, section });

    let groupedTimetable = {};
    let periods = [];

    scheduleData.forEach((slot) => {
      if (!groupedTimetable[slot.day_of_week]) {
        groupedTimetable[slot.day_of_week] = {};
      }

      groupedTimetable[slot.day_of_week][slot.lecture_number] = {
        subject: slot.subject_name || "-",
        teacher: slot.teacher_name || "N/A",
      };

      if (!periods.some((p) => p.id === slot.lecture_number)) {
        periods.push({
          id: slot.lecture_number,
          timeStr: slot.start_time,
          displayTime: `${slot.start_time} - ${slot.end_time}`,
        });
      }
    });

    const convertTimeToMinutes = (timeStr) => {
      if (!timeStr) return 0;
      let [time, modifier] = timeStr.trim().split(" ");
      let [hours, minutes] = time.split(":").map(Number);
      if (modifier) {
        const upperModifier = modifier.toUpperCase();
        if (upperModifier === "PM" && hours < 12) hours += 12;
        if (upperModifier === "AM" && hours === 12) hours = 0;
      } else if (hours >= 1 && hours <= 6) {
        hours += 12;
      }
      return hours * 60 + minutes;
    };

    periods.sort(
      (a, b) =>
        convertTimeToMinutes(a.timeStr) - convertTimeToMinutes(b.timeStr),
    );

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayNames = {
      Mon: "Mon",
      Tue: "Tue",
      Wed: "Wed",
      Thu: "Thu",
      Fri: "Fri",
      Sat: "Sat",
    };

    // 🔥 NEW VALIDATION LOGIC: Incomplete / Empty check
    let isComplete = true;
    let messageType = "none"; // 'none', 'missing', 'incomplete'

    if (periods.length === 0) {
      isComplete = false;
      messageType = "missing"; // Pura table hi gayab hai
    } else {
      // Loop chala kar check karo ki kya koi slot empty to nahi chuta hai
      for (let day of days) {
        for (let period of periods) {
          if (!groupedTimetable[day] || !groupedTimetable[day][period.id]) {
            isComplete = false;
            messageType = "incomplete"; // Ek ya zyada slots khali hain
            break;
          }
        }
        if (!isComplete) break;
      }
    }

    res.render("students/showTimeTable.ejs", {
      student,
      className,
      semester,
      section,
      groupedTimetable,
      periods,
      days,
      dayNames,
      isComplete, // Frontend ko batayega ki table valid hai ya nahi
      messageType, // Kis tarah ka alert show karna hai
       classIncharge, // 👈 Send Incharge Name
      hod
    });
  }),
);

app.get(
  "/show/fee/status",
 verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    let rollNo = req.session.rollNo;
    const studentId = req.session.studentId || req.session.userId;

    if (!rollNo && !studentId) {
      req.flash("error", "Session expired. Please log in again.");
      return res.redirect("/student/attendance/login");
    }

    // 🟢 2. Build Search Filter (Direct & Safe)
    let searchConditions = [];

    // Agar rollNo hai (jaise tumhare case me 6152 hai)
    if (rollNo) {
      searchConditions.push({ rollNumber: String(rollNo).trim() });
    }

    // Agar studentId bhi kisi student ke liye available hua
    if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
      searchConditions.push({
        student_id: new mongoose.Types.ObjectId(studentId),
      });
    }

    // Search Fee Ledger
    const feeLedger = await FeeLedger.findOne({ $or: searchConditions });

    if (!feeLedger) {
      req.flash(
        "error",
        `Fee Ledger record not found for Admin/Roll No: ${rollNo}`,
      );
      return res.redirect("/student/attendance");
    }

    // 🟢 3. Fetch Receipts/Transactions using FeeLedger's verified Student ID & Roll Number
    const transactions = await FeeTransaction.find({
      $or: [
        { student_id: feeLedger.student_id },
        { rollNumber: feeLedger.rollNumber },
      ],
    }).sort({ paymentDate: -1, createdAt: -1 });

    // 🟢 4. Render EJS View
    res.render("students/showFees.ejs", {
      feeLedger,
      transactions,
      studentName: req.session.studentName || feeLedger.studentName,
    });
  }),
);

// show mark sheeet


// 🟢 1. SHOW STUDENT MARKS / REPORT CARD DASHBOARD
// app.get(
//   "/student/view/marksheet",
//   isStudentVerified,
//   verifySession,
//   WrapAsync(async (req, res) => {
//     // Security Guard: Check logged in student
//     if (!req.user || !req.user._id) {
//       req.flash("error", "Session expired. Please login again.");
//       return res.redirect("/student/attendance/login");
//     }

//     const studentId = req.user._id;

//     // 🔍 Primary Lookup: Iss student ke jitne bhi marksheet records hain unhe fetch karo
//     const allStudentMarksheets = await Marks.find({
//       "students.studentId": studentId,
//     }).sort({ academicYear: -1, semester: -1 });

//     // Agar student ka ek bhi marksheet nahi mila
//     if (!allStudentMarksheets || allStudentMarksheets.length === 0) {
//       return res.render("students/marksDashboard.ejs", {
//         availableSessions: [],
//         availableSemesters: [],
//         selectedSession: null,
//         selectedSemester: null,
//         groupedExams: {},
//         overallStats: null,
//         message: "No examination records found for your profile.",
//       });
//     }

//     // 📊 Extract Unique Academic Years / Sessions (Dropdown filters ke liye)
//     const availableSessions = [
//       ...new Set(allStudentMarksheets.map((m) => m.academicYear.trim())),
//     ].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

//     // Query Params (User Filter Options)
//     const selectedSession = req.query.academicYear || availableSessions[0]; // Default: Latest Session

//     // Available Semesters for selected session
//     const sessionMarksheets = allStudentMarksheets.filter(
//       (m) => m.academicYear.trim() === selectedSession,
//     );

//     const availableSemesters = [
//       ...new Set(sessionMarksheets.map((m) => m.semester)),
//     ].sort((a, b) => Number(a) - Number(b));

//     const selectedSemester = req.query.semester
//       ? Number(req.query.semester)
//       : Number(availableSemesters[0]) || 1;

//     // 🎯 Active Filtered Marksheets (Current or Selected Historical Record)
//     const targetMarksheets = sessionMarksheets.filter(
//       (m) => Number(m.semester) === selectedSemester,
//     );

//     // Group Data by Exam Name (e.g. "INTERNAL-1", "MID TERM", "FINAL SEMESTER")
//     const groupedExams = {};
//     let totalObtainedMarks = 0;
//     let totalMaxMarks = 0;
//     let hasFailedAnySubject = false;

//     targetMarksheets.forEach((sheet) => {
//       // Student ka Specific Data Object Nikalo Array se
//       const myRecord = sheet.students.find(
//         (s) => String(s.studentId) === String(studentId),
//       );

//       if (myRecord) {
//         const examKey = sheet.examName.trim().toUpperCase();

//         if (!groupedExams[examKey]) {
//           groupedExams[examKey] = {
//             examName: sheet.examName,
//             examType: sheet.examType,
//             className: sheet.className,
//             section: sheet.section,
//             subjects: [],
//             totalExamObtained: 0,
//             totalExamMax: 0,
//           };
//         }

//         const isPass =
//           myRecord.attendanceStatus === "Present" &&
//           Number(myRecord.obtainedMarks) >= Number(sheet.passMarks);

//         if (!isPass && myRecord.attendanceStatus === "Present") {
//           hasFailedAnySubject = true;
//         }

//         groupedExams[examKey].subjects.push({
//           subjectName: sheet.subject,
//           maxMarks: sheet.maxMarks,
//           passMarks: sheet.passMarks,
//           obtainedMarks: myRecord.obtainedMarks,
//           attendanceStatus: myRecord.attendanceStatus,
//           remarks: myRecord.remarks || "-",
//           isPass: isPass,
//         });

//         if (myRecord.attendanceStatus === "Present") {
//           groupedExams[examKey].totalExamObtained +=
//             Number(myRecord.obtainedMarks) || 0;
//           totalObtainedMarks += Number(myRecord.obtainedMarks) || 0;
//         }
//         groupedExams[examKey].totalExamMax += Number(sheet.maxMarks) || 0;
//         totalMaxMarks += Number(sheet.maxMarks) || 0;
//       }
//     });

//     // Calculation for Overall Percentage
//     const overallPercentage =
//       totalMaxMarks > 0
//         ? ((totalObtainedMarks / totalMaxMarks) * 100).toFixed(2)
//         : "0.00";

//     const overallStats = {
//       totalObtainedMarks,
//       totalMaxMarks,
//       overallPercentage,
//       overallStatus: hasFailedAnySubject ? "NEEDS IMPROVEMENT / FAIL" : "PASS",
//     };

//     res.render("students/marksDashboard.ejs", {
//       availableSessions,
//       availableSemesters,
//       selectedSession,
//       selectedSemester,
//       groupedExams,
//       overallStats,
//       message: null,
//     });
//   }),
// );

// 🟢 1. SHOW STUDENT MARKS / REPORT CARD DASHBOARD (BUG-PROOF)
app.get(
  "/student/view/marksheet",
   verifySession, isStudentVerified,
  WrapAsync(async (req, res) => {
    // Security Guard: Check logged in student
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }

    const studentId = String(req.user._id);

    // 🔍 Fetch all marksheets where student exists
    const allStudentMarksheets = await Marks.find({
      "students.studentId": studentId,
    }).sort({ academicYear: -1, semester: -1 }).lean(); // .lean() converts to JS object for 3x faster response

    // Handle Empty Case
    if (!allStudentMarksheets || allStudentMarksheets.length === 0) {
      return res.render("students/marksDashboard.ejs", {
        availableSessions: [],
        availableSemesters: [],
        selectedSession: null,
        selectedSemester: null,
        groupedExams: {},
        overallStats: null,
        message: "No examination records found for your profile.",
      });
    }

    // 📊 1. Extract Clean Unique Academic Years
    const availableSessions = [
      ...new Set(
        allStudentMarksheets
          .map((m) => (m.academicYear ? String(m.academicYear).trim() : null))
          .filter(Boolean)
      ),
    ].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    // Fallback logic for selectedSession
    const selectedSession =
      req.query.academicYear && availableSessions.includes(req.query.academicYear.trim())
        ? req.query.academicYear.trim()
        : availableSessions[0];

    // Filter marksheets for selected session
    const sessionMarksheets = allStudentMarksheets.filter(
      (m) => m.academicYear && String(m.academicYear).trim() === selectedSession
    );

    // 📊 2. Extract Clean Unique Semesters for Selected Session
    const availableSemesters = [
      ...new Set(
        sessionMarksheets
          .map((m) => (m.semester !== undefined && m.semester !== null ? String(m.semester).trim() : null))
          .filter(Boolean)
      ),
    ].sort((a, b) => Number(a) - Number(b));

    // Fallback logic for selectedSemester
    const selectedSemester =
      req.query.semester && availableSemesters.includes(String(req.query.semester).trim())
        ? String(req.query.semester).trim()
        : availableSemesters[0] || "1";

    // 🎯 Filter Active Marksheets (Session + Semester matching)
    const targetMarksheets = sessionMarksheets.filter(
      (m) => String(m.semester).trim() === selectedSemester
    );

    // Grouping & Aggregation Engine
    const groupedExams = {};
    let totalObtainedMarks = 0;
    let totalMaxMarks = 0;
    let hasFailedAnySubject = false;

    targetMarksheets.forEach((sheet) => {
      const myRecord = sheet.students.find(
        (s) => String(s.studentId) === studentId
      );

      if (myRecord) {
        // Unique Exam Key combining Exam Name & Type to prevent accidental collisions
        const rawExamName = sheet.examName ? sheet.examName.trim() : "EXAM";
        const examKey = `${rawExamName.toUpperCase()}_${sheet.examType || "GENERAL"}`;

        if (!groupedExams[examKey]) {
          groupedExams[examKey] = {
            examName: rawExamName,
            examType: sheet.examType || "N/A",
            className: sheet.className || "-",
            section: sheet.section || "-",
            subjects: [],
            totalExamObtained: 0,
            totalExamMax: 0,
          };
        }

        const maxMarksNum = Number(sheet.maxMarks) || 0;
        const passMarksNum = Number(sheet.passMarks) || 0;
        const obtainedMarksNum = Number(myRecord.obtainedMarks) || 0;
        const isPresent = myRecord.attendanceStatus === "Present";

        const isPass = isPresent && obtainedMarksNum >= passMarksNum;

        if (!isPass && isPresent) {
          hasFailedAnySubject = true;
        }

        groupedExams[examKey].subjects.push({
          subjectName: sheet.subject || "Subject",
          maxMarks: maxMarksNum,
          passMarks: passMarksNum,
          obtainedMarks: obtainedMarksNum,
          attendanceStatus: myRecord.attendanceStatus || "Present",
          remarks: myRecord.remarks || "-",
          isPass: isPass,
        });

        if (isPresent) {
          groupedExams[examKey].totalExamObtained += obtainedMarksNum;
          totalObtainedMarks += obtainedMarksNum;
        }
        
        groupedExams[examKey].totalExamMax += maxMarksNum;
        totalMaxMarks += maxMarksNum;
      }
    });

    // Safe Percentage Calculation (Avoids NaN / Infinity)
    const overallPercentage =
      totalMaxMarks > 0
        ? ((totalObtainedMarks / totalMaxMarks) * 100).toFixed(2)
        : "0.00";

    const overallStats = {
      totalObtainedMarks,
      totalMaxMarks,
      overallPercentage,
      overallStatus: hasFailedAnySubject ? "NEEDS IMPROVEMENT / FAIL" : "PASS",
    };

    res.render("students/marksDashboard.ejs", {
      availableSessions,
      availableSemesters,
      selectedSession,
      selectedSemester,
      groupedExams,
      overallStats,
      message: Object.keys(groupedExams).length === 0 ? "No records found for the selected filter." : null,
    });
  })
);


// app.get("/student/logout",  verifySession, isStudentVerified,(req, res) => {
//   // Clear ALL Student Session Variables
//   delete req.session.userId;
//   delete req.session.studentId;
//   delete req.session.rollNo;
//   delete req.session.role;
//   delete req.session.loginTime;
//   delete req.session.otpVerified;

//   // Force Save Session to ensure Flash Message is retained
//   req.session.save((err) => {
//     if (err) console.error("Student Logout Session Save Error:", err);
//     req.flash("success", "Logged out successfully!");
//     return res.redirect("/student/attendance/login");
//   });
// });

app.get("/student/logout", verifySession, isStudentVerified, (req, res) => {
  // 1. Session ID ko regenerate karein taaki purana Student data destroy ho jaye
  req.session.regenerate((err) => {
    if (err) {
      console.error("Student Logout Session Regenerate Error:", err);
      return res.redirect("/student/attendance/login");
    }

    // 2. Naye clean session me Flash set karein
    req.flash("success", "Logged out successfully!");

    // 3. Save and Redirect
    req.session.save((saveErr) => {
      if (saveErr) console.error("Student Logout Session Save Error:", saveErr);
      return res.redirect("/student/attendance/login");
    });
  });
});

// ////  student folder closed////


app.use((req, res, next) => {
  next(new ExpressError(404, "page not found"));
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Something went wrong";
  console.log(statusCode);
  console.log(message);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(statusCode).render("listings/error.ejs", {
    message,
    statusCode,
  });
});


// io.use(async (socket, next) => {
//   try {
//     const session = socket.request.session;

//     if (!session || !session.userId || !session.role) {
//       return next(new Error("Unauthorized"));
//     }

//     socket.userId = String(session.userId);
//     socket.role = session.role;

//     next();
//   } catch (err) {
//     console.error("Socket authentication error:", err);
//     next(new Error("Unauthorized"));
//   }
// });


// app.listen(5000, (req, res) => {
//   console.log(`All clear ${5000}`);
// });

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server + Socket.io running on port ${PORT}`);
});

///  working atendance

// DB Connection URL

// async function createInitialAdmin() {
//   try {
//     // 1. Connect to MongoDB
//     await mongoose.connect(dbUrl);
//     console.log("🟢 Database connected successfully...");

//     const adminEmail = "admin@gmail.com";
//     const adminUsername = "admin";

//     // 2. Check if Admin already exists
//     const existingAdmin = await Admin.findOne({
//       $or: [{ email: adminEmail }, { username: adminUsername }]
//     });

//     if (existingAdmin) {
//       console.log("⚠️ Admin with this email or username already exists!");
//       process.exit(0);
//     }

//     // 3. Create Admin Object with ALL REQUIRED FIELDS
//     const newAdmin = new Admin({
//       name: "Super Admin",            // 👈 REQUIRED FIELD FIX
//       username: adminUsername,       // 👈 REQUIRED FIELD FIX
//       email: adminEmail,            // REQUIRED
//       password: "password@123", // 👈 Schema ka pre('save') hook isey auto-hash kar dega!
//       status: "Active",
//       passwordChangedAt: new Date()  // Verify session sync ke liye
//     });

//     // 4. Save to Database (Pre-save hook will hash password automatically)
//     await newAdmin.save();

//     console.log("✅ Admin Created Successfully!");
//     console.log("-----------------------------------------");
//     console.log(`Name:     ${newAdmin.name}`);
//     console.log(`Username: ${newAdmin.username}`);
//     console.log(`Email:    ${newAdmin.email}`);
//     console.log(`Password: AdminPassword@123`);
//     console.log("-----------------------------------------");

//   } catch (err) {
//     console.error("❌ Error creating admin:", err.message);
//   } finally {
//     // Graceful Exit
//     await mongoose.connection.close();
//     process.exit(0);
//   }
// }

// // Execute
// createInitialAdmin();
