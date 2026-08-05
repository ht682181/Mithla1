if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}

const express = require("express");
const app = express();
const mongoose = require("mongoose");
const ExpressError = require("./utils/ExpressError.js");
const WrapAsync = require("./utils/WrapAsync.js");
const path = require("path");
const ejsmate = require("ejs-mate");
const methodOverride = require("method-override");
const multer = require("multer");
const { storage } = require("./cloudStorage.js");
const upload = multer({ storage });

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

const storageMemory = multer.memoryStorage();
const uploadBuffer = multer({ storage: storageMemory });
const xlsx = require("xlsx");
const AttendanceArchive = require("./models/attendanceArchive.js");
const TimeTable = require("./models/TimeTable.js");
const { FeeLedger, FeeTransaction } = require("./models/feesRecord.js");

// ------------------ MongoStore + Session Setup ------------------

const session = require("express-session");
const MongoStore = require("connect-mongo");
const dbUrl = process.env.ATLASDB_URL;

// const dns = require("dns");

// // Google Public DNS set karein SRV lookup ke liye
// dns.setDefaultResultOrder("ipv4first");
// dns.setServers(["8.8.8.8", "8.8.4.4"]);

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
const createStudent = require("./helpers/createStudent.js");
// const { VERSION } = require("ejs");
// // const { Verify } = require("crypto");

app.use(session(sessionOptions));
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

// session function for verify the user

function verifiedAny(req, res, next) {
  if (req.session.adminVerified || req.session.otpVerified) {
    return next();
  }

  req.flash("error", "Please login now!");
  return res.redirect("/student/attendance/login");
}

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
  1 * 60 * 1000,
); // every 2 minutes

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
  1 * 60 * 1000,
); // every 1 minute

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
  1 * 60 * 1000, // Har 2 minute me chalega
);

console.log("Mongo URL:", process.env.ATLASDB_URL);

// users login

app.get("/student/attendance/login", (req, res) => {
  res.render("users/login.ejs");
});

// app.post(
//   "/student/attendance/login",
//   WrapAsync(async (req, res) => {
//     try {
//       const { role, username, password } = req.body;

//       // const studentPassword = process.env.STUDENT_PASSWORD;
//       const adminUsername = process.env.ADMIN_USERNAME;
//       const adminPassword = process.env.ADMIN_PASSWORD;
//       const adminRole = process.env.ROLE_1;
//       const teacherRole = process.env.ROLE_2;
//       const studentRole = process.env.ROLE_3;

//       req.session.adminVerified = false;

//       // ================= ADMIN LOGIN =================
//       if (adminRole === role) {
//         if (adminUsername === username && adminPassword === password) {
//           req.session.adminVerified = true;
//           req.flash("success", "Login successfully");
//           return res.redirect("/admin/student/attendance");
//         } else {
//           req.flash("error", "Incorrect password");
//           return res.redirect("/student/attendance/login");
//         }
//       }

//       // ================= TEACHER LOGIN =================
//       if (teacherRole === role) {
//         return res.redirect(307, "/login/modal");
//       }

//       // ================= STUDENT LOGIN =================

//       if (studentRole === role) {
//         req.session.otpVerified = false;

//         const student = await Student.findOne({
//           rollNo: parseInt(username),
//           password: password,
//         });

//         if (!student) {
//           req.flash("error", "Incorrect password");
//           return res.redirect("/student/attendance/login");
//         }

//         req.session.rollNo = username;

//         // 🔥 FIRST TIME PASSWORD UPDATE CHECK
//         if (student.check !== "update") {
//           return res.redirect("/student/update/password");
//         }

//         req.session.otpVerified = true;
//         req.flash("success", " Login Successfully");
//         return res.redirect("/student/attendance");
//       }

//       // ================= INVALID ROLE =================
//       req.flash("error", "Role not matched");
//       return res.redirect("/student/attendance/login");
//     } catch (err) {
//       console.error("Login Error:", err);
//       req.flash("error", "Something went wrong, please try again");
//       return res.redirect("/student/attendance/login");
//     }
//   }),
// );

// app.post(
//   "/student/attendance/login",
//   WrapAsync(async (req, res) => {
//     const { role, username, password } = req.body || {};

//     const adminRole = process.env.ROLE_1 || "Admin";
//     const teacherRole = process.env.ROLE_2 || "Teacher";
//     const studentRole = process.env.ROLE_3 || "Student";

//     // 🔴 1. ROLE VALIDATION & TRIMMING
//     if (!role || !username || !password) {
//       req.flash("error", "All fields are required.");
//       return res.redirect("/student/attendance/login");
//     }

//     const cleanUsername = String(username).trim();
//     const cleanPassword = String(password).trim();

//     // =========================================================================
//     // 👑 1. ADMIN LOGIN
//     // =========================================================================
//     if (role === adminRole) {
//       // Database se Admin find karo (.select("+password") ke sath)
//       let admin = await Admin.findOne({ username: cleanUsername }).select("+password");

//       // Environment variables fallback check (agar DB me static admin environment se chalta ho)
//       const envAdminUser = process.env.ADMIN_USERNAME;
//       const envAdminPass = process.env.ADMIN_PASSWORD;

//       let isMatch = false;

//       // Case A: DB Admin Check (Bcrypt Compare)
//       if (admin && admin.password) {
//         // Agar bcrypt hashed password hai
//         if (admin.password.startsWith("$2a$") || admin.password.startsWith("$2b$")) {
//           isMatch = await bcrypt.compare(cleanPassword, admin.password);
//         } else {
//           // Fallback plain-text check (sirf legacy DB data ke liye)
//           isMatch = admin.password === cleanPassword;
//         }
//       }
//       // Case B: Env Admin Fallback Check
//       else if (envAdminUser && envAdminPass && cleanUsername === envAdminUser && cleanPassword === envAdminPass) {
//         isMatch = true;
//       }

//       if (!isMatch) {
//         req.flash("error", "Invalid username or password");
//         return res.redirect("/student/attendance/login");
//       }

//       // Check Blocked Status
//       if (admin && admin.status === "Blocked") {
//         req.flash("error", "Your account is blocked. Please contact super admin.");
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 SESSION FIXATION & CLEANUP (Purani Student/Teacher session clean karo)
//       delete req.session.otpVerified;
//       delete req.session.rollNo;
//       delete req.session.studentId;

//       req.session.adminVerified = true;
//       req.session.userId = admin._id.toString() ,
//       req.session.role = adminRole;
//       req.session.loginTime = new Date(); // 👈 MANDATORY FOR MULTI-DEVICE AUTO LOGOUT

//       return req.session.save((err) => {
//         if (err) console.error("Session Save Error:", err);
//         req.flash("success", "Login successfully");
//         return res.redirect("/admin/student/attendance");
//       });
//     }

//     // =========================================================================
//     // 👨‍🏫 2. TEACHER LOGIN
//     // =========================================================================
//     if (role === teacherRole) {
//       // 🔴 Session Cleanup before modal redirect
//       delete req.session.adminVerified;
//       delete req.session.otpVerified;
//       delete req.session.rollNo;
//       delete req.session.studentId;

//       // 307 Redirect for Modal POST handling
//       return res.redirect(307, "/login/modal");
//     }

//     // =========================================================================
//     // 🎓 3. STUDENT LOGIN
//     // =========================================================================
//     if (role === studentRole) {
//       const rollNoNum = parseInt(cleanUsername, 10);
//       if (isNaN(rollNoNum)) {
//         req.flash("error", "Invalid username or password");
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 DB Query with .select("+password") for safe hash fetching
//       const student = await Student.findOne({ rollNo: rollNoNum }).select("+password");

//       if (!student) {
//         req.flash("error", "Invalid username or password");
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 BCRYPT PASSWORD COMPARISON
//       let isPasswordValid = false;
//       if (student.password.startsWith("$2a$") || student.password.startsWith("$2b$")) {
//         isPasswordValid = await bcrypt.compare(cleanPassword, student.password);
//       } else {
//         // Plain text fallback if student is created via legacy script
//         isPasswordValid = student.password === cleanPassword;
//       }

//       if (!isPasswordValid) {
//         req.flash("error", "Invalid username or password");
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 BLOCKED STATUS CHECK
//       if (student.status === "Blocked") {
//         req.flash("error", "Your account is blocked. Please contact admin.");
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 SESSION CLEANUP (Admin session flag remove karo)
//       delete req.session.adminVerified;

//       // 🔴 SET STUDENT SESSION DATA WITH _id & loginTime
//       req.session.userId = student._id.toString(); // 👈 MANDATORY FOR isLoggedIn Middleware
//       req.session.studentId = student._id.toString(); // Mongo ObjectId (Immutable)
//       req.session.rollNo = student.rollNo;
//       req.session.role = studentRole;
//       req.session.loginTime = new Date(); // 👈 MANDATORY FOR Multi-Device Logout

//       // 🔥 FIRST TIME PASSWORD UPDATE CHECK
//       if (student.check !== "update") {
//         req.session.otpVerified = false;
//         return req.session.save((err) => {
//           if (err) console.error("Session Save Error:", err);
//           return res.redirect("/student/update/password");
//         });
//       }

//       req.session.otpVerified = true;

//       return req.session.save((err) => {
//         if (err) console.error("Session Save Error:", err);
//         req.flash("success", "Login Successfully");
//         return res.redirect("/student/attendance");
//       });
//     }

//     // =========================================================================
//     // ❌ 4. INVALID ROLE FALLBACK
//     // =========================================================================
//     req.flash("error", "Role not matched");
//     return res.redirect("/student/attendance/login");
//   })
// );

// app.post(
//   "/student/attendance/login",
//   WrapAsync(async (req, res) => {
//     const { role, username, password } = req.body || {};

//     const adminRole = process.env.ROLE_1 || "Admin";
//     const teacherRole = process.env.ROLE_2 || "Teacher";
//     const studentRole = process.env.ROLE_3 || "Student";

//     // 🔴 1. ROLE VALIDATION & TRIMMING
//     if (!role || !username || !password) {
//       req.flash("error", "All fields are required.");
//       return res.redirect("/student/attendance/login");
//     }

//     const cleanUsername = String(username).trim();
//     const cleanPassword = String(password).trim();

//     // =========================================================================
//     // 👑 1. ADMIN LOGIN
//     // =========================================================================
//     if (role === adminRole) {
//       // Database se Admin find karo
//       let admin = await Admin.findOne({ username: cleanUsername }).select(
//         "+password",
//       );

//       if (!admin) {
//         req.flash("error", "Invalid username or password");
//         return res.redirect("/student/attendance/login");
//       }

//       let isMatch = false;

//       // 👑 DB Admin Password Check (Bcrypt + Legacy Plain-Text Fallback)
//       if (admin.password) {
//         try {
//           isMatch = await bcrypt.compare(cleanPassword, admin.password);
//         } catch (bcryptErr) {
//           isMatch = admin.password === cleanPassword;
//         }
//       }

//       if (!isMatch) {
//         req.flash("error", "Invalid username or password");
//         return res.redirect("/student/attendance/login");
//       }

//       // Check Blocked Status
//       if (admin.status === "Blocked") {
//         req.flash(
//           "error",
//           "Your account is blocked. Please contact super admin.",
//         );
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 SESSION FIXATION & CLEANUP
//       delete req.session.passport;
//       delete req.session.otpVerified;
//       delete req.session.rollNo;
//       delete req.session.studentId;

//       req.session.adminVerified = true;
//       req.session.userId = admin._id.toString();
//       req.session.role = adminRole;
//       req.session.loginTime = new Date().toISOString(); // 👈 String format prevents MongoStore serialization drop

//       return req.session.save((err) => {
//         if (err) console.error("Session Save Error:", err);
//         req.flash("success", "Login successfully");
//         return res.redirect("/admin/student/attendance");
//       });
//     }

//     // =========================================================================
//     // 👨‍🏫 2. TEACHER LOGIN
//     // =========================================================================
//     if (role === teacherRole) {
//       // 🔴 Session Cleanup before modal redirect
//       delete req.session.adminVerified;
//       delete req.session.otpVerified;
//       delete req.session.rollNo;
//       delete req.session.studentId;
//       delete req.session.userId;

//       // 307 Redirect for Modal POST handling
//       return res.redirect(307, "/login/modal");
//     }

//     // =========================================================================
//     // 🎓 3. STUDENT LOGIN
//     // =========================================================================
//     if (role === studentRole) {
//       const rollNoNum = parseInt(cleanUsername, 10);
//       if (isNaN(rollNoNum)) {
//         req.flash("error", "Invalid username or password");
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 DB Query
//       const student = await Student.findOne({ rollNo: rollNoNum }).select(
//         "+password",
//       );

//       if (!student) {
//         req.flash("error", "Invalid username or password");
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 BCRYPT & LEGACY PASSWORD COMPARISON
//       let isPasswordValid = false;

//       try {
//         isPasswordValid = await bcrypt.compare(cleanPassword, student.password);
//       } catch (bcryptErr) {
//         isPasswordValid = student.password === cleanPassword;
//       }

//       if (!isPasswordValid) {
//         req.flash("error", "Invalid username or password");
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 BLOCKED STATUS CHECK
//       if (student.status === "Blocked") {
//         req.flash("error", "Your account is blocked. Please contact admin.");
//         return res.redirect("/student/attendance/login");
//       }

//       // 🔴 SESSION CLEANUP
//       delete req.session.passport;
//       delete req.session.adminVerified;

//       // 🔴 SET STUDENT SESSION DATA
//       req.session.userId = student._id.toString();
//       req.session.studentId = student._id.toString();
//       req.session.rollNo = student.rollNo;
//       req.session.role = studentRole;
//       req.session.loginTime = new Date().toISOString(); // 👈 String format avoids session save loss

//       // 🔥 FIRST TIME PASSWORD UPDATE CHECK
//       if (student.check !== "update") {
//         req.session.otpVerified = false;
//         return req.session.save((err) => {
//           if (err) console.error("Session Save Error:", err);
//           return res.redirect("/student/update/password");
//         });
//       }

//       req.session.otpVerified = true;

//       return req.session.save((err) => {
//         if (err) console.error("Session Save Error:", err);
//         req.flash("success", "Login Successfully");
//         return res.redirect("/student/attendance");
//       });
//     }

//     // =========================================================================
//     // ❌ 4. INVALID ROLE FALLBACK
//     // =========================================================================
//     req.flash("error", "Role not matched");
//     return res.redirect("/student/attendance/login");
//   }),
// );



app.post(
  "/student/attendance/login",
  WrapAsync(async (req, res) => {
    const { role, username, password } = req.body || {};

    const adminRole = process.env.ROLE_1 || "Admin";
    const teacherRole = process.env.ROLE_2 || "Teacher";
    const studentRole = process.env.ROLE_3 || "Student";

    // 🔴 1. ROLE VALIDATION & TRIMMING
    if (!role || !username || !password) {
      req.flash("error", "All fields are required.");
      return res.redirect("/student/attendance/login");
    }

    const cleanUsername = String(username).trim();
    const cleanPassword = String(password).trim();

    // 🔴 BULLETPROOF PASSPORT & SESSION PURGE HELPER
    const purgePreviousSession = (req, callback) => {
      // 1. Force Passport Logout if passport active
      if (typeof req.logout === "function") {
        req.logout((err) => {
          if (err) console.error("Passport logout error during session purge:", err);
          
          // Clear All Keys
          delete req.session.passport;
          delete req.session.userId;
          delete req.session.studentId;
          delete req.session.rollNo;
          delete req.session.adminVerified;
          delete req.session.otpVerified;
          delete req.session.role;

          return callback();
        });
      } else {
        delete req.session.passport;
        delete req.session.userId;
        delete req.session.studentId;
        delete req.session.rollNo;
        delete req.session.adminVerified;
        delete req.session.otpVerified;
        delete req.session.role;

        return callback();
      }
    };

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
          isMatch = (admin.password === cleanPassword);
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

      // 🔴 PURGE OLD TEACHER/STUDENT SESSION BEFORE CREATING ADMIN SESSION
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
    // 👨‍🏫 2. TEACHER LOGIN
    // =========================================================================
    if (role === teacherRole) {
      // 🔴 PURGE CUSTOM SESSION KEYS BEFORE PASSPORT MODAL REDIRECT
      delete req.session.adminVerified;
      delete req.session.otpVerified;
      delete req.session.rollNo;
      delete req.session.studentId;
      delete req.session.userId;

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
        isPasswordValid = (student.password === cleanPassword);
      }

      if (!isPasswordValid) {
        req.flash("error", "Invalid username or password");
        return res.redirect("/student/attendance/login");
      }

      if (student.status === "Blocked") {
        req.flash("error", "Your account is blocked. Please contact admin.");
        return res.redirect("/student/attendance/login");
      }

      // 🔴 PURGE OLD TEACHER/ADMIN SESSION BEFORE CREATING STUDENT SESSION
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

app.put(
  "/edit/teacher/:id",
  verifySession, isAdminVerified,
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

    // Normal fields update (Trimmed for cleanliness)
    if (name) teacher.name = name.trim();
    if (email) teacher.email = email.trim().toLowerCase();
    if (username) teacher.username = username.trim();
    if (mobile) teacher.mobile = mobile.trim();

    // 🔴 1. PASSWORD & TIMESTAMP UPDATE LOGIC
    if (password && password.trim() !== "") {
      try {
        // Passport-Local-Mongoose setPassword method
        await teacher.setPassword(password.trim());

        // 🔴 Explicitly passwordChangedAt timestamp update karna
        teacher.passwordChangedAt = new Date();
      } catch (passErr) {
        console.error("SetPassword Error:", passErr);
        req.flash("error", "Failed to update password. Please try again.");
        return res.redirect(`/edit/teacher/${id}`);
      }
    }

    // 🔴 2. SAFE IMAGE HANDLING
    if (req.file) {
      teacher.image = {
        url: req.file.path,
        filename: req.file.filename,
      };
    }

    // 🔴 3. SAVE WITH DUPLICATE KEY ERROR CATCHING
    try {
      await teacher.save();
    } catch (saveErr) {
      // Catch MongoDB Unique Constraint Errors (Duplicate Username/Email/Mobile)
      if (saveErr.code === 11000) {
        const field = Object.keys(saveErr.keyValue || {})[0] || "field";
        req.flash(
          "error",
          `Update failed! A teacher with this ${field} already exists.`,
        );
        return res.redirect(`/edit/teacher/${id}`);
      }
      throw saveErr; // Re-throw for general WrapAsync handler
    }

    req.flash("success", "Teacher updated successfully!");
    return res.redirect(`/teacher/profile/${id}`);
  }),
);

// DELETE TEACHER

app.delete(
  "/delete/teacher/:id",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let teacher = await Teacher.findByIdAndDelete(id);
    req.flash("success", "Teacher deleted successfully");
    res.redirect("/show/teacher");
  }),
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

app.put(
  "/edit/student/:id",
   verifySession, isAdminVerified,
  upload.single("data[image]"),
  validateStudent,
  WrapAsync(async (req, res) => {
    const { id } = req.params;
    let { data } = req.body || {};

    // 1. Fetch Existing Student from DB
    let student = await Student.findById(id);

    if (!student) {
      req.flash("error", "Student record not found!");
      return res.redirect("/student/list");
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
    // Empty/null password string delete kiya taaki old hashed password safe rahe
    delete data.password;

    Object.assign(student, data);

    try {
      await student.save();
    } catch (saveErr) {
      if (
        saveErr.code === 11000 &&
        saveErr.keyValue &&
        saveErr.keyValue.rollNo !== undefined
      ) {
        req.flash(
          "error",
          `Update failed! Admin Number (${saveErr.keyValue.rollNo}) is already assigned to another student.`,
        );
        return res.redirect(`/edit/student/${id}`);
      }

      throw saveErr;
    }

    req.flash("success", "Student details updated successfully!");
    return res.redirect(`/student/profile/${id}`);
  }),
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

app.put(
  "/edit/subject/:subjectId",
   verifySession, isAdminVerified,
  validateSubject,
  WrapAsync(async (req, res) => {
    let subjectId = req.params.subjectId;
    let subject = await Subject.findByIdAndUpdate(subjectId, {
      ...req.body.data,
    });
    await subject.save();
    req.flash("success", "Subject edit successfully");
    res.redirect("/show/subject");
  }),
);

// delete subject

app.delete(
  "/delete/subject/:id",
  verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    let { id } = req.params;
    let subject = await Subject.findByIdAndDelete(id);
    req.flash("success", "Subject deleted successfully");
    res.redirect("/show/subject");
  }),
);

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
  verifySession, isAdminVerified,
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
                secObj.temporarySubjects.includes(slot.subject)
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

          let { lecture_number, start_time, end_time, subject, username } =
            slot;
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
            sectionObj = semesterObj.sections[semesterObj.sections.length - 1];
          }

          const isAlreadyTemp =
            sectionObj.temporarySubjects &&
            sectionObj.temporarySubjects.includes(subject);

          if (!sectionObj.subjects.includes(subject) && !isAlreadyTemp) {
            sectionObj.subjects.push(subject);
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

            // 1. Check karo regular week schedule me hai ya nahi
            const stillAssignedSomewhere = currentWeekSchedule.some(
              (s) => s.teacher_id && s.teacher_id.toString() === oldTeacherId,
            );

            // 2. Safe Helper: Find existing teacher subdoc section
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

            // 🔥 FIX: Agar Na Regular Lecture Bacha Hoga AUR Na hi Koi Temporary Subject -> TABHI PRUNE KARO
            if (!stillAssignedSomewhere && existingTempSubs.length === 0) {
              if (classIdx !== -1 && semIdx !== -1) {
                let targetSem =
                  targetTeacherDoc.class[classIdx].semesters[semIdx];
                targetSem.sections = targetSem.sections.filter(
                  (sec) => sec.section !== section,
                );

                // Parent Array Cascade Prune
                if (targetSem.sections.length === 0) {
                  targetTeacherDoc.class[classIdx].semesters.splice(semIdx, 1);
                }
                if (targetTeacherDoc.class[classIdx].semesters.length === 0) {
                  targetTeacherDoc.class.splice(classIdx, 1);
                }
              }
            } else {
              // 🛡️ Teacher regular me ho YA temporary subject bacha ho -> Dynamic Sync
              const activeSubjectsInWeek = currentWeekSchedule
                .filter(
                  (s) =>
                    s.teacher_id &&
                    s.teacher_id.toString() === oldTeacherId &&
                    s.subject_name,
                )
                .map((s) => s.subject_name);

              if (secIdx !== -1) {
                const secRef =
                  targetTeacherDoc.class[classIdx].semesters[semIdx].sections[
                    secIdx
                  ];
                const tempSubs = secRef.temporarySubjects || [];

                // Final Active List = Timetable Subjects + Temporary Subjects
                const finalSubjectsList = [
                  ...new Set([...activeSubjectsInWeek, ...tempSubs]),
                ];

                secRef.subjects = finalSubjectsList;
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

// POST  ROUTE  TIME TABLE OR TEACHER ASSIGN KE LIYE

// app.post(
//   "/assign/teacher/subject/bulk-day",
//   verifiedAny,
//   WrapAsync(async (req, res) => {
//     const session = await Teacher.startSession();
//     try {
//       const baseData = req.body.baseData || {};
//       const slotsObj = req.body.slots || {};
//       // Frontend se hidden input me aayega isEdit
//       const isEdit = req.body.isEdit === "true" || req.body.isEdit === true;
//       const { className, semester, section, day_of_week } = baseData;

//       let slots = Array.isArray(slotsObj) ? slotsObj : Object.values(slotsObj);

//       if (
//         !className ||
//         !semester ||
//         !section ||
//         !day_of_week ||
//         !slots ||
//         slots.length === 0
//       ) {
//         req.flash(
//           "error",
//           "⚠️ Invalid dataset or missing mandatory class coordinates.",
//         );
//         return res.redirect("/assign/teacher/subject/class");
//       }

//       // =================================================================
//       // 🔥 BLOCKER LOGIC: DIRECT SAVE SE SAFETY
//       // =================================================================
//       if (!isEdit) {
//         const checkExisting = await TimeTable.findOne({
//           className,
//           semester,
//           section,
//           day_of_week,
//         });
//         if (checkExisting) {
//           req.flash(
//             "error",
//             `⚠️ Schedule Already Exists: The schedule for ${day_of_week} has already been saved. Please click 'Edit' on the Dashboard to modify it.`,
//           );
//           return res.redirect("/assign/teacher/subject/class");
//         }
//       }

//       // 🛡️ BACKEND SECURE AUTO-SYNC: Monday template fallback for other days
//       if (day_of_week !== "Mon") {
//         const mondayLayout = await TimeTable.find({
//           className,
//           semester,
//           section,
//           day_of_week: "Mon",
//         }).sort({ _id: 1 });

//         if (!mondayLayout || mondayLayout.length === 0) {
//           req.flash(
//             "error",
//             "⚠️ Operation Aborted: Please configure Monday's schedule first to freeze the timetable timings.",
//           );
//           return res.redirect("/assign/teacher/subject/class");
//         }

//         slots = slots.map((slot, index) => {
//           const masterRow = mondayLayout[index];
//           if (masterRow) {
//             return {
//               ...slot,
//               lecture_number: masterRow.lecture_number,
//               start_time: masterRow.start_time,
//               end_time: masterRow.end_time,
//             };
//           }
//           return slot;
//         });
//       }

//       const lunchSlotsCount = slots.filter(
//         (s) => s && s.lecture_number === "LUNCH",
//       ).length;
//       if (lunchSlotsCount === 0) {
//         req.flash("error", "⚠️ Server Denied: Lunch break is compulsory.");
//         return res.redirect("/assign/teacher/subject/class");
//       }

//       await session.withTransaction(async () => {
//         // =================================================================
//         // 🛑 CRITICAL STAGE 1: MONDAY TIMING CASCADE PRE-CHECK INTERCEPTOR
//         // =================================================================
//         if (isEdit && day_of_week === "Mon") {
//           for (let slot of slots) {
//             if (
//               !slot ||
//               slot.lecture_number === "LUNCH" ||
//               !slot.username ||
//               !slot.subject
//             )
//               continue;

//             const targetNewStart = convertTo12HourFormat(slot.start_time);
//             const targetNewEnd = convertTo12HourFormat(slot.end_time);
//             const newStartMins = timeToMinutes(targetNewStart);
//             const newEndMins = timeToMinutes(targetNewEnd);

//             // Baaki saare dino (Tue-Sat) me jo is lecture number ke records hain unke teachers check karo
//             const cascadeTargets = await TimeTable.find({
//               className,
//               semester,
//               section,
//               lecture_number: slot.lecture_number,
//               day_of_week: { $ne: "Mon" },
//             }).session(session);

//             for (let target of cascadeTargets) {
//               if (!target.teacher_id) continue;

//               // Check karo ki is target teacher ka us partcular day par doosri classes me koi clash toh nahi ho raha?
//               const potentialClashes = await TimeTable.find({
//                 day_of_week: target.day_of_week,
//                 teacher_id: target.teacher_id,
//                 // Apni current class ko chhod kar baaki jagah check karo
//                 $or: [
//                   { className: { $ne: className } },
//                   { semester: { $ne: semester } },
//                   { section: { $ne: section } },
//                 ],
//               }).session(session);

//               for (let clash of potentialClashes) {
//                 const existingStartMins = timeToMinutes(clash.start_time);
//                 const existingEndMins = timeToMinutes(clash.end_time);

//                 if (
//                   newStartMins < existingEndMins &&
//                   newEndMins > existingStartMins
//                 ) {
//                   throw new Error(
//                     `⚠️ Schedule Conflict: If you change Monday's timing, ${target.day_of_week}'s timing will also change. This will create a timing conflict for ${target.teacher_name}, who is already assigned to another class [${clash.className} ${clash.section}] from ${clash.start_time} to ${clash.end_time}.`,
//                   );
//                 }
//               }
//             }
//           }
//         }

//         // =================================================================
//         // 🎯 STAGE 2: BACKUP TARGET DAY SLOTS & REWRITE TIMETABLE GRID
//         // =================================================================
//         let oldSlots = [];
//         let historicTeachersList = [];

//         if (isEdit) {
//           oldSlots = await TimeTable.find({
//             className,
//             semester,
//             section,
//             day_of_week,
//           }).session(session);
//           // Purane saare genuine teacher IDs ki unique list track kar lo calculation ke liye
//           historicTeachersList = [
//             ...new Set(
//               oldSlots
//                 .map((s) => (s.teacher_id ? s.teacher_id.toString() : null))
//                 .filter(Boolean),
//             ),
//           ];
//         }

//         // Target day ka schema data delete karo taaki fresh insert ho sake
//         await TimeTable.deleteMany({
//           className,
//           semester,
//           section,
//           day_of_week,
//         }).session(session);

//         // Naye entries ko map aur save karne ka system loop
//         for (let slot of slots) {
//           if (!slot) continue;

//           let { lecture_number, start_time, end_time, subject, username } =
//             slot;
//           const isLunch = lecture_number === "LUNCH";

//           const formattedStartTime =
//             day_of_week === "Mon"
//               ? convertTo12HourFormat(start_time)
//               : start_time;
//           const formattedEndTime =
//             day_of_week === "Mon" ? convertTo12HourFormat(end_time) : end_time;

//           if (isLunch) {
//             const lunchSlot = new TimeTable({
//               day_of_week,
//               lecture_number: "LUNCH",
//               start_time: formattedStartTime,
//               end_time: formattedEndTime,
//               className,
//               semester,
//               section,
//               teacher_name: "N/A",
//               subject_name: "🍔 LUNCH BREAK",
//             });
//             await lunchSlot.save({ session });
//             continue;
//           }

//           if (!subject || !username) continue;

//           const teacherObj = await Teacher.findOne({ username }).session(
//             session,
//           );
//           if (!teacherObj)
//             throw new Error(`Faculty matching '${username}' not found.`);

//           // Direct insertion time clash check
//           const newStartMins = timeToMinutes(formattedStartTime);
//           const newEndMins = timeToMinutes(formattedEndTime);

//           const teacherAllAssignments = await TimeTable.find({
//             day_of_week,
//             teacher_id: teacherObj._id,
//           }).session(session);

//           for (let assignment of teacherAllAssignments) {
//             const existingStartMins = timeToMinutes(assignment.start_time);
//             const existingEndMins = timeToMinutes(assignment.end_time);

//             if (
//               newStartMins < existingEndMins &&
//               newEndMins > existingStartMins
//             ) {
//               throw new Error(
//                 `Timing Conflict! ${teacherObj.name} is already busy in Class [${assignment.className} ${assignment.section}] from ${assignment.start_time} to ${assignment.end_time}.`,
//               );
//             }
//           }

//           // Fresh timetable row allocation
//           const newSlot = new TimeTable({
//             day_of_week,
//             lecture_number,
//             start_time: formattedStartTime,
//             end_time: formattedEndTime,
//             className,
//             semester,
//             section,
//             teacher_id: teacherObj._id,
//             teacher_name: teacherObj.name,
//             subject_name: subject,
//           });
//           await newSlot.save({ session });

//           // Sync Assignments inside current teacher document matrix safely
//           let classObj = teacherObj.class.find(
//             (cls) => cls.className === className,
//           );
//           if (!classObj) {
//             classObj = { className, semesters: [] };
//             teacherObj.class.push(classObj);
//             classObj = teacherObj.class[teacherObj.class.length - 1];
//           }

//           let semesterObj = classObj.semesters.find(
//             (sem) => sem.semester == semester,
//           );
//           if (!semesterObj) {
//             semesterObj = { semester: semester, sections: [] };
//             classObj.semesters.push(semesterObj);
//             semesterObj = classObj.semesters[classObj.semesters.length - 1];
//           }

//           let sectionObj = semesterObj.sections.find(
//             (sec) => sec.section === section,
//           );
//           if (!sectionObj) {
//             sectionObj = { section, subjects: [] };
//             semesterObj.sections.push(sectionObj);
//             sectionObj = semesterObj.sections[semesterObj.sections.length - 1];
//           }

//           if (!sectionObj.subjects.includes(subject)) {
//             sectionObj.subjects.push(subject);
//           }

//           teacherObj.markModified("class");
//           await teacherObj.save({ session });
//         }

//         // =================================================================
//         // 🛡️ STAGE 3: SMART GLOBAL AUDIT FOR PROFILE SYNCHRONIZATION
//         // =================================================================
//         if (isEdit && historicTeachersList.length > 0) {
//           // Poore hafte (Mon-Sat) ka absolutely update status database se pull karo
//           const currentWeekSchedule = await TimeTable.find({
//             className,
//             semester,
//             section,
//           }).session(session);

//           for (let oldTeacherId of historicTeachersList) {
//             // Check karo ki kya yeh teacher pure hafte me kahi zinda hai is section me?
//             const stillAssignedSomewhere = currentWeekSchedule.some(
//               (s) => s.teacher_id && s.teacher_id.toString() === oldTeacherId,
//             );

//             const targetTeacherDoc =
//               await Teacher.findById(oldTeacherId).session(session);
//             if (!targetTeacherDoc) continue;

//             if (!stillAssignedSomewhere) {
//               // Case A: Agar teacher ka poore hafte is section se namo-nishan mit chuka hai -> Purge Section entry completely
//               let classIdx = targetTeacherDoc.class.findIndex(
//                 (c) => c.className === className,
//               );
//               if (classIdx !== -1) {
//                 let semIdx = targetTeacherDoc.class[
//                   classIdx
//                 ].semesters.findIndex((s) => s.semester == semester);
//                 if (semIdx !== -1) {
//                   targetTeacherDoc.class[classIdx].semesters[semIdx].sections =
//                     targetTeacherDoc.class[classIdx].semesters[
//                       semIdx
//                     ].sections.filter((sec) => sec.section !== section);
//                 }
//               }
//             } else {
//               // Case B: Agar teacher abhi bhi assigned hai (chahe doosre lecture me ya doosre din)
//               // Toh hum nikalenge ki is specific section me use ab active subjects konse assigned hain poore hafte me
//               const activeSubjectsInWeek = currentWeekSchedule
//                 .filter(
//                   (s) =>
//                     s.teacher_id &&
//                     s.teacher_id.toString() === oldTeacherId &&
//                     s.subject_name,
//                 )
//                 .map((s) => s.subject_name);

//               let classIdx = targetTeacherDoc.class.findIndex(
//                 (c) => c.className === className,
//               );
//               if (classIdx !== -1) {
//                 let semIdx = targetTeacherDoc.class[
//                   classIdx
//                 ].semesters.findIndex((s) => s.semester == semester);
//                 if (semIdx !== -1) {
//                   let secIdx = targetTeacherDoc.class[classIdx].semesters[
//                     semIdx
//                   ].sections.findIndex((s) => s.section === section);
//                   if (secIdx !== -1) {
//                     // Ghost subjects saaf ho jayenge par active dynamic subjects bache rahenge safely!
//                     targetTeacherDoc.class[classIdx].semesters[semIdx].sections[
//                       secIdx
//                     ].subjects = [...new Set(activeSubjectsInWeek)];
//                   }
//                 }
//               }
//             }
//             targetTeacherDoc.markModified("class");
//             await targetTeacherDoc.save({ session });
//           }
//         }

//         // =================================================================
//         // ⏱️ STAGE 4: MONDAY CASCADE EXECUTION (Post validation success)
//         // =================================================================
//         if (isEdit && day_of_week === "Mon") {
//           for (let slot of slots) {
//             if (!slot) continue;
//             const formattedStartTime = convertTo12HourFormat(slot.start_time);
//             const formattedEndTime = convertTo12HourFormat(slot.end_time);

//             await TimeTable.updateMany(
//               {
//                 className,
//                 semester,
//                 section,
//                 lecture_number: slot.lecture_number,
//                 day_of_week: { $ne: "Mon" },
//               },
//               {
//                 $set: {
//                   start_time: formattedStartTime,
//                   end_time: formattedEndTime,
//                 },
//               },
//               { session },
//             );
//           }
//         }
//       });

//       req.flash(
//         "success",
//         isEdit
//           ? "Timetable layout updated with Master Monday cascades successfully! 🚀"
//           : "Full day grid configuration saved successfully! 🚀",
//       );
//       res.redirect(`/timetable/dashboard?className=${className}`);
//     } catch (err) {
//       console.error(
//         "🔥 Timetable Clash Interceptor Block triggered:",
//         err.message,
//       );
//       req.flash("error", `Transaction Failed: ${err.message}`);
//       res.redirect("/assign/teacher/subject/class");
//     } finally {
//       await session.endSession();
//     }
//   }),
// );

// DELETE TIME TABLE  AND ASSIGN CLASSES

// app.post(
//   "/timetable/delete-section",
//   verifiedAny,
//   WrapAsync(async (req, res) => {
//     const session = await Teacher.startSession();
//     try {
//       const { className, semester, section } = req.body;

//       if (!className || !semester || !section) {
//         req.flash(
//           "error",
//           "⚠️ Operation Failed: Missing core parameters to delete section.",
//         );
//         return res.redirect("/timetable/dashboard");
//       }

//       await session.withTransaction(async () => {
//         // 1. Is poore section ke saare dino (Mon-Sat) ke saare slots nikal lo
//         const allSectionSlots = await TimeTable.find({
//           className,
//           semester,
//           section,
//         }).session(session);

//         if (allSectionSlots.length === 0) {
//           throw new Error(
//             "Nothing to delete. No schedule data was found for this section.",
//           );
//         }

//         const uniqueTeacherIds = [
//           ...new Set(
//             allSectionSlots
//               .map((slot) => slot.teacher_id && slot.teacher_id.toString())
//               .filter(Boolean),
//           ),
//         ];

//         for (let teacherId of uniqueTeacherIds) {
//           const teacherObj = await Teacher.findById(teacherId).session(session);

//           if (teacherObj) {
//             // Teacher ke profiles array me se is pure section/semester ka object dhoodho aur usko clean karo
//             let classIdx = teacherObj.class.findIndex(
//               (c) => c.className === className,
//             );
//             if (classIdx !== -1) {
//               let semIdx = teacherObj.class[classIdx].semesters.findIndex(
//                 (s) => s.semester == semester,
//               );
//               if (semIdx !== -1) {
//                 // Direct is section ko hi array se baahar uda do (pull out the entire section matching target)
//                 teacherObj.class[classIdx].semesters[semIdx].sections =
//                   teacherObj.class[classIdx].semesters[semIdx].sections.filter(
//                     (sec) => sec.section !== section,
//                   );
//               }
//             }

//             teacherObj.markModified("class");
//             await teacherObj.save({ session });
//           }
//         }

//         await TimeTable.deleteMany({ className, semester, section }).session(
//           session,
//         );
//       });

//       req.flash(
//         "success",
//         `🗑️ Section Deleted: The complete schedule for [${className} - Sem ${semester} - Sec ${section}] and all associated teacher assignments have been successfully removed.`,
//       );
//       res.redirect(
//         `/timetable/dashboard?className=${encodeURIComponent(className)}`,
//       );
//     } catch (err) {
//       console.error("🔥 Bulk Section Delete Error:", err.message);
//       req.flash("error", `Master Deletion Failed: ${err.message}`);
//       res.redirect("/timetable/dashboard");
//     } finally {
//       await session.endSession();
//     }
//   }),
// );

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
          subject: slot.subject_name || "🍔 LUNCH BREAK",
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

// app.post(
//   "/temporary/assign/teacher/subject/class",
//   verifiedAny,
//   WrapAsync(async (req, res) => {
//     // 1. Transaction session start karo safety ke liye
//     const session = await Teacher.startSession();

//     try {
//       let { className, semester, section, usernames, subjects } = req.body.data;

//       // Sanitization: Agar single checkbox select kiya ho toh use array banao
//       if (!usernames) usernames = [];
//       if (!subjects) subjects = [];
//       if (!Array.isArray(usernames)) usernames = [usernames];
//       if (!Array.isArray(subjects)) subjects = [subjects];

//       // Pehle validation check kar lo
//       if (usernames.length === 0 || subjects.length === 0 || !className || !semester || !section) {
//         req.flash("error", "All fields, at least one teacher and one subject must be selected!");
//         return res.redirect("/temporary/assign/teacher/subject/class");
//       }

//       // 2. Start the isolated safe transaction
//       await session.withTransaction(async () => {

//         // Har select kiye huye teacher par loop chalao
//         const teacherPromises = usernames.map(async (username) => {
//           const teacher = await Teacher.findOne({ username }).session(session);
//           if (!teacher) return;

//           // Step A: Find or Create Class Level
//           let classObj = teacher.class.find((cls) => cls.className === className);
//           if (!classObj) {
//             classObj = { className, semesters: [] };
//             teacher.class.push(classObj);
//             classObj = teacher.class[teacher.class.length - 1]; // get reference
//           }

//           // Step B: Find or Create Semester Level
//           let semesterObj = classObj.semesters.find((sem) => sem.semester == semester);
//           if (!semesterObj) {
//             semesterObj = { semester: Number(semester), sections: [] };
//             classObj.semesters.push(semesterObj);
//             semesterObj = classObj.semesters[classObj.semesters.length - 1];
//           }

//           // Step C: Find or Create Section Level
//           let sectionObj = semesterObj.sections.find((sec) => sec.section === section);
//           if (!sectionObj) {
//             // New section create karte waqt temporarySubjects bhi initialize kar rahe hain
//             sectionObj = { section, subjects: [], temporarySubjects: [] };
//             semesterObj.sections.push(sectionObj);
//             sectionObj = semesterObj.sections[semesterObj.sections.length - 1];
//           }

//           // Make sure temporarySubjects array exists on old documents
//           if (!sectionObj.temporarySubjects) {
//             sectionObj.temporarySubjects = [];
//           }

//           // Step D: Bulk Push Selected Subjects (Duplicates se bach kar)
//           subjects.forEach((subName) => {
//             // 1. Attendance System ke liye: Main subjects array mein exact string push karo
//             if (!sectionObj.subjects.includes(subName)) {
//               sectionObj.subjects.push(subName);
//             }

//             // 2. Tracking/Filter ke liye: Parallel temporarySubjects array mein push karo
//             if (!sectionObj.temporarySubjects.includes(subName)) {
//               sectionObj.temporarySubjects.push(subName);
//             }
//           });

//           // Mongoose sub-document validation warning reset
//           teacher.markModified('class');
//           return teacher.save({ session });
//         });

//         // Saare teachers ka data parallelly process hoga safely
//         await Promise.all(teacherPromises);
//       });

//       // 3. Agar sab sahi raha toh final success flash
//       req.flash("success", `Successfully temporary assigned ${subjects.length} subjects to ${usernames.length} teachers! 🚀`);
//       res.redirect("/temporary/assign/teacher/subject/class");

//     } catch (err) {
//       // 4. Rollback execution if any single loop crashes
//       console.error("🔥 Bulk Assignment Failed. Changes Rolled back:", err);
//       req.flash("error", "Transaction failed! No changes were saved to the database.");
//       res.redirect("/temporary/assign/teacher/subject/class");
//     } finally {
//       await session.endSession(); // Session wrap-up
//     }
//   }),
// );

app.post(
  "/temporary/assign/teacher/subject/class",
   verifySession, isAdminVerified,
  WrapAsync(async (req, res) => {
    // 1. Transaction session start karo safety ke liye
    const session = await Teacher.startSession();

    try {
      let { className, semester, section, usernames, subjects } = req.body.data;

      // Sanitization: Agar single checkbox select kiya ho toh use array banao
      if (!usernames) usernames = [];
      if (!subjects) subjects = [];
      if (!Array.isArray(usernames)) usernames = [usernames];
      if (!Array.isArray(subjects)) subjects = [subjects];

      // Pehle validation check kar lo
      if (
        usernames.length === 0 ||
        subjects.length === 0 ||
        !className ||
        !semester ||
        !section
      ) {
        req.flash(
          "error",
          "All fields, at least one teacher and one subject must be selected!",
        );
        return res.redirect("/temporary/assign/teacher/subject/class");
      }

      // 2. Start the isolated safe transaction
      await session.withTransaction(async () => {
        // =================================================================
        // 🛑 PRE-CHECK INTERCEPTOR: REGULAR TIMETABLE CONFLICT CHECK
        // =================================================================
        for (let username of usernames) {
          const teacher = await Teacher.findOne({ username }).session(session);
          if (!teacher) continue;

          for (let subName of subjects) {
            // Check if this teacher is already assigned this subject in TimeTable for this class/sem/sec
            const existingTimetableSlot = await TimeTable.findOne({
              className,
              semester,
              section,
              teacher_id: teacher._id,
              subject_name: subName,
            }).session(session);

            if (existingTimetableSlot) {
              throw new Error(
                `⚠️ Cannot assign temporary subject: '${subName}' is already assigned to ${teacher.name} via the regular timetable!`,
              );
            }
          }
        }

        // Har select kiye huye teacher par loop chalao
        const teacherPromises = usernames.map(async (username) => {
          const teacher = await Teacher.findOne({ username }).session(session);
          if (!teacher) return;

          // Step A: Find or Create Class Level
          let classObj = teacher.class.find(
            (cls) => cls.className === className,
          );
          if (!classObj) {
            classObj = { className, semesters: [] };
            teacher.class.push(classObj);
            classObj = teacher.class[teacher.class.length - 1]; // get reference
          }

          // Step B: Find or Create Semester Level
          let semesterObj = classObj.semesters.find(
            (sem) => sem.semester == semester,
          );
          if (!semesterObj) {
            semesterObj = { semester: Number(semester), sections: [] };
            classObj.semesters.push(semesterObj);
            semesterObj = classObj.semesters[classObj.semesters.length - 1];
          }

          // Step C: Find or Create Section Level
          let sectionObj = semesterObj.sections.find(
            (sec) => sec.section === section,
          );
          if (!sectionObj) {
            // New section create karte waqt temporarySubjects bhi initialize kar rahe hain
            sectionObj = { section, subjects: [], temporarySubjects: [] };
            semesterObj.sections.push(sectionObj);
            sectionObj = semesterObj.sections[semesterObj.sections.length - 1];
          }

          // Make sure temporarySubjects array exists on old documents
          if (!sectionObj.temporarySubjects) {
            sectionObj.temporarySubjects = [];
          }

          // Step D: Bulk Push Selected Subjects (Duplicates se bach kar)
          subjects.forEach((subName) => {
            // 1. Attendance System ke liye: Main subjects array mein exact string push karo
            if (!sectionObj.subjects.includes(subName)) {
              sectionObj.subjects.push(subName);
            }

            // 2. Tracking/Filter ke liye: Parallel temporarySubjects array mein push karo
            if (!sectionObj.temporarySubjects.includes(subName)) {
              sectionObj.temporarySubjects.push(subName);
            }
          });

          // Mongoose sub-document validation warning reset
          teacher.markModified("class");
          return teacher.save({ session });
        });

        // Saare teachers ka data parallelly process hoga safely
        await Promise.all(teacherPromises);
      });

      // 3. Agar sab sahi raha toh final success flash
      req.flash(
        "success",
        `Successfully temporary assigned ${subjects.length} subjects to ${usernames.length} teachers! 🚀`,
      );
      res.redirect("/temporary/assign/teacher/subject/class");
    } catch (err) {
      // 4. Rollback execution if any single loop crashes or validation fails
      console.error(
        "🔥 Bulk Assignment Failed. Changes Rolled back:",
        err.message,
      );

      const userMessage = err.message.startsWith("⚠️")
        ? err.message
        : "Transaction failed! No changes were saved to the database.";

      req.flash("error", userMessage);
      res.redirect("/temporary/assign/teacher/subject/class");
    } finally {
      await session.endSession(); // Session wrap-up
    }
  }),
);

// 🔹 1. SHOW TEMPORARY ASSIGNMENTS
// app.get(
//   "/show-temporary-teachers-assignments",
//   verifiedAny,
//   WrapAsync(async (req, res) => {
//     // Query simplification: Fetch teachers having non-empty temporarySubjects
//     const teachers = await Teacher.find({
//       "class.semesters.sections.temporarySubjects.0": { $exists: true }
//     }).lean();

//     let tableRows = [];

//     teachers.forEach((teacher) => {
//       teacher.class?.forEach((cls) => {
//         cls.semesters?.forEach((sem) => {
//           sem.sections?.forEach((sec) => {
//             // Check if array exists and has at least one item
//             if (Array.isArray(sec.temporarySubjects) && sec.temporarySubjects.length > 0) {
//               // Filter out any blank/empty strings if any
//               const cleanTempSubjects = sec.temporarySubjects
//                 .map(s => String(s).trim())
//                 .filter(s => s.length > 0);

//               if (cleanTempSubjects.length > 0) {
//                 tableRows.push({
//                   teacherId: teacher._id.toString(),
//                   teacherName: teacher.name || "Unknown",
//                   username: teacher.username || "N/A",
//                   classId: cls._id ? cls._id.toString() : "",
//                   className: cls.className || "N/A",
//                   semesterId: sem._id ? sem._id.toString() : "",
//                   semester: sem.semester || "N/A",
//                   sectionId: sec._id ? sec._id.toString() : "",
//                   section: sec.section || "N/A",
//                   subjects: cleanTempSubjects,
//                 });
//               }
//             }
//           });
//         });
//       });
//     });

//     res.render("admin/showTemporaryAssign.ejs", { tableRows });
//   })
// );
// // 🔹 2. DELETE TEMPORARY ASSIGNMENT
// app.delete(
//   "/delete/temporary/teacher/:teacherId/class/:classId/semester/:semesterId/section/:sectionId",
//   verifiedAny,
//   WrapAsync(async (req, res) => {
//     const { teacherId, classId, semesterId, sectionId } = req.params;

//     const session = await Teacher.startSession();
//     session.startTransaction();

//     try {
//       const teacher = await Teacher.findById(teacherId).session(session);

//       if (!teacher) {
//         await session.abortTransaction();
//         session.endSession();
//         req.flash("error", "Teacher record not found!");
//         return res.redirect("/show-temporary-teachers-assignments");
//       }

//       // Safe access using Mongoose .id() helper
//       const targetClass = teacher.class?.id(classId);
//       const targetSem = targetClass?.semesters?.id(semesterId);
//       const targetSec = targetSem?.sections?.id(sectionId);

//       if (!targetSec) {
//         await session.abortTransaction();
//         session.endSession();
//         req.flash("error", "Section not found or already removed!");
//         return res.redirect("/show-temporary-teachers-assignments");
//       }

//       const tempSubsStrings = (targetSec.temporarySubjects || []).map(s => String(s));

//       if (tempSubsStrings.length > 0) {
//         // Step A: Clear Temporary Subjects array
//         targetSec.temporarySubjects = [];

//         // Step B: Filter out temporary subjects safely using String conversion
//         targetSec.subjects = (targetSec.subjects || []).filter(
//           (sub) => !tempSubsStrings.includes(String(sub))
//         );

//         // Step C: Cascading Clean-up (If section becomes empty)
//         if (targetSec.subjects.length === 0 && targetSec.temporarySubjects.length === 0) {
//           targetSem.sections.pull({ _id: sectionId });
//         }

//         if (targetSem.sections.length === 0) {
//           targetClass.semesters.pull({ _id: semesterId });
//         }

//         if (targetClass.semesters.length === 0) {
//           teacher.class.pull({ _id: classId });
//         }

//         // Mark nested structure as modified for Mongoose tracking
//         teacher.markModified("class");
//         await teacher.save({ session });
//       }

//       await session.commitTransaction();
//       session.endSession();

//       req.flash("success", "Temporary assignment deleted successfully!");
//       res.redirect("/show-temporary-teachers-assignments");
//     } catch (error) {
//       await session.abortTransaction();
//       session.endSession();
//       console.error("🔥 Error deleting temporary assignment:", error);
//       req.flash("error", "Something went wrong! Action safely rolled back.");
//       res.redirect("/show-temporary-teachers-assignments");
//     }
//   })
// );

// 🔹 1. SHOW TEMPORARY TEACHERS ASSIGNMENTS
app.get(
  "/show-temporary-teachers-assignments",
   verifySession, isAdminVerified,
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
              const cleanTempSubjects = sec.temporarySubjects
                .map((s) => String(s).trim())
                .filter((s) => s.length > 0);

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
  }),
);

// 🔹 2. DELETE TEMPORARY ASSIGNMENT (BUG-FIXED & TIMETABLE-SAFE)
app.delete(
  "/delete/temporary/teacher/:teacherId/class/:classId/semester/:semesterId/section/:sectionId",
   verifySession, isAdminVerified,
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

      const regularSubjectsList = [
        ...new Set(
          activeTimetableSlots
            .map((s) => s.subject_name)
            .filter((sub) => sub && sub !== "🍔 LUNCH BREAK"),
        ),
      ];

      // Step 3: Update `subjects` array -> Keep ONLY regular timetable subjects
      targetSec.subjects = regularSubjectsList;

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
        "Temporary assignment deleted successfully without affecting regular timetable!",
      );
      res.redirect("/show-temporary-teachers-assignments");
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("🔥 Error deleting temporary assignment:", error);
      req.flash("error", "Something went wrong! Action safely rolled back.");
      res.redirect("/show-temporary-teachers-assignments");
    }
  }),
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
//   verifiedAny,
//   validateAssignStudent,
//   WrapAsync(async (req, res) => {
//     try {
//       let { students, subjects } = req.body.data;

//       if (!students || !subjects) {
//         req.flash("error", "Students and subjects are missing!");
//         return res.redirect("/assign/student/subject");
//       }

//       if (!Array.isArray(students)) students = [students];
//       if (!Array.isArray(subjects)) subjects = [subjects];

//       // ✅ decode + parse
//       subjects = subjects.map((s) =>
//         typeof s === "string" ? JSON.parse(decodeURIComponent(s)) : s,
//       );

//       // 🔥 Har student ke liye individual check aur update chalao
//       let totalAssignedCount = 0;

//       const updatePromises = students.map(async (studentId) => {
//         // 1. Pehle us student ke current subjects nikaalo
//         const student = await Student.findById(studentId).select("subject");
//         if (!student) return;

//         // 2. Is specific student ke paas jo codes hain unka set banao
//         const studentExistingCodes = new Set(
//           student.subject.map((s) => s.code),
//         );

//         // 3. Sirf wahi subjects filter karo jo IS student ke paas nahi hain
//         const uniqueNewSubjectsForThisStudent = subjects.filter(
//           (sub) => !studentExistingCodes.has(sub.code),
//         );

//         // 4. Agar naye subjects hain, toh isi student ke document mein push karo
//         if (uniqueNewSubjectsForThisStudent.length > 0) {
//           totalAssignedCount += uniqueNewSubjectsForThisStudent.length;
//           return Student.updateOne(
//             { _id: studentId },
//             { $push: { subject: { $each: uniqueNewSubjectsForThisStudent } } },
//           );
//         }
//       });

//       // Saare updates ek sath parallelly execute honge (High Performance)
//       await Promise.all(updatePromises);

//       if (totalAssignedCount === 0) {
//         req.flash(
//           "info",
//           "All selected subjects were already assigned to these students 😄",
//         );
//       } else {
//         req.flash("success", "Subjects assigned successfully ✅");
//       }

//       res.redirect("/assign/student/subject");
//     } catch (err) {
//       console.error("🔥 Assign Subject Error:", err);
//       req.flash("error", "Something went wrong!");
//       res.redirect("/assign/student/subject");
//     }
//   }),
// );

app.post(
  "/assign/student/subject",
  verifySession, isAdminVerified,
  validateAssignStudent,
  WrapAsync(async (req, res) => {
    // 1. Transaction Session Start Karo
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      let { students, subjects } = req.body.data || {};

      if (!students || !subjects) {
        await session.abortTransaction();
        session.endSession();
        req.flash("error", "Students and subjects are missing!");
        return res.redirect("/assign/student/subject");
      }

      if (!Array.isArray(students)) students = [students];
      if (!Array.isArray(subjects)) subjects = [subjects];

      // ✅ Safe JSON Parsing with try-catch
      try {
        subjects = subjects.map((s) =>
          typeof s === "string" ? JSON.parse(decodeURIComponent(s)) : s,
        );
      } catch (parseErr) {
        throw new Error("Invalid subject payload format!");
      }

      // 2. Pure Batch Ke Students Ko Ek Hi Query Mein Fetch Karo (Session Context)
      const existingStudents = await Student.find(
        { _id: { $in: students } },
        "subject",
      ).session(session);

      const bulkOps = [];
      let totalAssignedCount = 0;

      // 3. In-Memory Duplication Filter (Super Fast)
      for (const student of existingStudents) {
        const studentExistingCodes = new Set(
          (student.subject || []).map((s) => s.code),
        );

        const uniqueNewSubjects = subjects.filter(
          (sub) => sub && sub.code && !studentExistingCodes.has(sub.code),
        );

        if (uniqueNewSubjects.length > 0) {
          totalAssignedCount += uniqueNewSubjects.length;

          // Bulk Write Operation Prepare Karo
          bulkOps.push({
            updateOne: {
              filter: { _id: student._id },
              update: { $push: { subject: { $each: uniqueNewSubjects } } },
            },
          });
        }
      }

      // 4. Agar Operations Hain Toh Write Commit Karo
      if (bulkOps.length > 0) {
        await Student.bulkWrite(bulkOps, { session });
      }

      // ✅ SAARE UPDATES SUCCESSFUL! NOW COMMIT TRANSACTION
      await session.commitTransaction();
      session.endSession();

      if (totalAssignedCount === 0) {
        req.flash(
          "info",
          "All selected subjects were already assigned to these students 😄",
        );
      } else {
        req.flash("success", "Subjects assigned successfully ✅");
      }

      return res.redirect("/assign/student/subject");
    } catch (err) {
      // 🚨 KOI BHI ERROR AAYA TOH TRANSACTION ROLLBACK HAR CHEEZ WAPAS PEHLE JAISI
      await session.abortTransaction();
      session.endSession();

      console.error("🔥 Assign Subject Rollback Triggered Error:", err);
      req.flash("error", `Failed to assign subjects: ${err.message}`);
      return res.redirect("/assign/student/subject");
    }
  }),
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
        select: "name class semester",
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

app.post("/student/update/class/semester", verifiedAny, async (req, res) => {
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
});

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



app.get("/admin/logout",  verifySession, isAdminVerified,(req, res) => {
  // Clear ALL Admin Session Variables
  delete req.session.userId;
  delete req.session.adminVerified;
  delete req.session.role;
  delete req.session.loginTime;

  req.session.save((err) => {
    if (err) console.error("Admin Logout Session Save Error:", err);
    req.flash("success", "Logged out successfully!");
    return res.redirect("/student/attendance/login");
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

app.post("/login/modal", (req, res, next) => {
  passport.authenticate("local", (err, teacher, info) => {
    if (err) {
      console.error("Passport Auth Error:", err);
      req.flash("error", "Something went wrong during authentication.");
      return res.redirect("/student/attendance/login");
    }

    // 🔴 1. INVALID CREDENTIALS
    if (!teacher) {
      req.flash("error", info?.message || "Invalid username or password");
      return res.redirect("/student/attendance/login");
    }

    // 🔴 2. BLOCKED TEACHER CHECK
    if (teacher.status === "Blocked") {
      req.flash(
        "error",
        "Your account is blocked by administrator. Access denied.",
      );
      return res.redirect("/student/attendance/login");
    }

    // 🔴 3. PASSPORT REQ.LOGIN EXECUTION
    req.logIn(teacher, (loginErr) => {
      if (loginErr) {
        console.error("Req Login Error:", loginErr);
        req.flash("error", "Failed to initialize session.");
        return res.redirect("/student/attendance/login");
      }

      const teacherRole = process.env.ROLE_2 || "Teacher";

      // 🔴 4. SESSION CLEANUP (Admin/Student Variables Remove Karo)
      delete req.session.adminVerified;
      delete req.session.otpVerified;
      delete req.session.rollNo;
      delete req.session.studentId;

      // 🔴 5. MANDATORY SESSION VARIABLES FOR ISLOGGEDIN MIDDLEWARE & MULTI-DEVICE LOGOUT
      req.session.userId = teacher._id.toString(); // 👈 Compulsory for isLoggedIn
      req.session.role = teacherRole;
      req.session.loginTime = req.session.loginTime = new Date().toISOString(); // 👈 Compulsory for passwordChangedAt comparison

      // 🔴 6. FORCE SAVE SESSION BEFORE REDIRECT
      return req.session.save((saveErr) => {
        if (saveErr) console.error("Session Save Error:", saveErr);
        req.flash("success", `Welcome back, ${teacher.name}!`);
        return res.redirect("/teacher/student/attendance");
      });
    });
  })(req, res, next);
});

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
    const secObj = semObj?.sections?.find((s) => s.section === section);

    if (!secObj || !(secObj.subjects || []).includes(subject)) {
      req.flash("error", "Unauthorized access or subject not assigned to you.");
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

// GET Unique Academic Years for Logged-in Teacher
app.get(
  "/get-teacher-academic-years",
    verifySession, isLoggedIn,
  WrapAsync(async (req, res) => {
    if (!req.user || !req.user._id) {
      req.flash("error", "Session expired. Please login again.");
      return res.redirect("/student/attendance/login");
    }
    // Is teacher ne jitne bhi unique academicYears me entries ki hain, unhe fetch karo
    const years = await Marks.distinct("academicYear", {
      teacherId: req.user._id,
    });

    //     years.sort((a, b) => b - a);

    //     res.json(years);
    //   })
    // );

    const validYears = years.filter(Boolean).map((y) => String(y).trim());
    validYears.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    res.json(validYears);
  }),
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

    const teacherSubjects = secObj.subjects || [];
    if (!teacherSubjects.includes(selectedSubject)) {
      req.flash(
        "error",
        "This subject is not assigned to you for this section.",
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

// app.post(
//   "/update/student/attendance",
//   isLoggedIn,
//   WrapAsync(async (req, res) => {
//     const { data } = req.body;
//     const { class: className, semester, section, subject,teacherName } = data;

//     // 🔥 Normalizer (future proof)
//     const normalize = (str) =>
//       str?.toString().trim().toLowerCase().replace(/\s+/g, " ");

//     const cleanClass = className.trim();
//     const cleanSemester = semester.trim();
//     const cleanSection = section.trim();
//     const cleanSubject = subject.trim();

//     // ===== Save session (cleaned) =====
//     // req.session.class = cleanClass;
//     // req.session.semester = cleanSemester;
//     // req.session.section = cleanSection;
//     // req.session.subject = cleanSubject;

//     // ===== Teacher check =====
//     const teacher = await Teacher.findById(req.user._id);
//     if (!teacher) {
//       req.flash("error", "Teacher not found");
//       return res.redirect("/update/student/attendance");
//     }

//     const classObj = teacher.class?.find(
//       (c) => normalize(c.className) === normalize(cleanClass),
//     );
//     const semObj = classObj?.semesters?.find(
//       (s) => normalize(s.semester) === normalize(cleanSemester),
//     );
//     const secObj = semObj?.sections?.find(
//       (s) => normalize(s.section) === normalize(cleanSection),
//     );

//     if (!classObj || !semObj || !secObj) {
//       req.flash("error", "Class / Semester / Section not assigned to you");
//       return res.redirect("/update/student/attendance");
//     }

//     // ===== Find attendance records =====
//     const records = await AttendenceDuplicate.find({
//       attendance: {
//         $elemMatch: {
//           teacherId: req.user._id,
//           class: cleanClass,
//           semester: cleanSemester,
//           section: cleanSection,
//           subject: cleanSubject,
//         },
//       },
//     });

//     if (!records.length) {
//       req.flash("error", "No attendance found for update");
//       return res.redirect("/update/student/attendance");
//     }

//     // ===== Filter valid (within 24 hours) =====
//     const now = new Date();

//     const validAttendances = records.flatMap((r) =>
//       r.attendance.filter((att) => {
//         const hoursDiff = (now - new Date(att.date)) / (1000 * 60 * 60);

//         return (
//           att.teacherId.toString() === req.user._id.toString() &&
//           normalize(att.class) === normalize(cleanClass) &&
//           normalize(att.semester) === normalize(cleanSemester) &&
//           normalize(att.section) === normalize(cleanSection) &&
//           normalize(att.subject) === normalize(cleanSubject) &&
//           hoursDiff <= 24
//         );
//       }),
//     );

//     if (!validAttendances.length) {
//       req.flash("error", "Update allowed only within 24 hours");
//       return res.redirect("/update/student/attendance");
//     }

//     // ===== Latest attendance =====
//     const latest = validAttendances.sort(
//       (a, b) => new Date(b.date) - new Date(a.date),
//     )[0];

//     const currentAttendance = {
//       periods: latest.periods,
//       unit: latest.unit,
//       description: latest.description,
//       date: latest.date,
//     };

//     // ===== Fetch students =====
//     const students = await Student.find({
//       class: cleanClass,
//       semester: cleanSemester,
//       section: cleanSection,
//     });

//     if (!students.length) {
//       req.flash("error", "No students found");
//       return res.redirect("/update/student/attendance");
//     }

//     // ===== Build status map =====
//     const statusMap = {};

//     for (const record of records) {
//       const att = record.attendance.find(
//         (a) =>
//           a.teacherId.toString() === req.user._id.toString() &&
//           normalize(a.class) === normalize(cleanClass) &&
//           normalize(a.semester) === normalize(cleanSemester) &&
//           normalize(a.section) === normalize(cleanSection) &&
//           normalize(a.subject) === normalize(cleanSubject),
//       );

//       if (att) {
//         statusMap[record.studentId.toString()] = att.status || "Not marked";
//       }
//     }

//     const studentsWithStatus = students.map((stu) => ({
//       ...stu.toObject(),
//       attendanceToday: statusMap[stu._id.toString()] || "Not marked",
//     }));

//     // ===== Subject permission =====
//     const studentSubjects = students.flatMap((s) =>
//       s.subject.map((sub) =>
//         typeof sub === "string" ? sub.trim() : sub.name.trim(),
//       ),
//     );

//     const teacherSubjects = secObj.subjects?.map((sub) => sub.trim()) || [];

//     const commonSubjects = teacherSubjects.filter((sub) =>
//       studentSubjects.includes(sub),
//     );

//     if (!commonSubjects.includes(cleanSubject)) {
//       req.flash("error", "You are not allowed for this subject");
//       return res.redirect("/update/student/attendance");
//     }

//     // ===== Render =====
//     res.render("teachers/updateAttenPage.ejs", {
//       students: studentsWithStatus,
//       subject: cleanSubject,
//       cleanClass,
//       cleanSection,
//       cleanSemester,
//       teacherName,
//       commonSubjects,
//       currentAttendance,
//     });
//   }),
// );

// app.post(
//   "/attendance/updateAll",
//   WrapAsync(async (req, res) => {
//     const { students, period, unit, description, subject,className,semester,section,teacherName } = req.body;

//     // const section = req.session.section;
//     // const classes = req.session.class;
//     // const semester = req.session.semester;
//     // const teacherName = req.session.teacherName;
//     console.log(period, unit, description, subject,className,semester,section,teacherName );
//     const now = new Date();

//     try {
//       const todayStart = new Date();
//       todayStart.setHours(0, 0, 0, 0);
//       console.log(todayStart);

//       const todayEnd = new Date();
//       todayEnd.setHours(23, 59, 59, 999);

//       let updatedCount = 0;

//       for (const [id, status] of Object.entries(students)) {
//         /* =========================================================
//            🔹 1️⃣ ATTENDENCE DUPLICATE CHECK
//         ========================================================== */

//         const duplicateDoc = await AttendenceDuplicate.findOne({
//           studentId: id,
//         });

//         if (duplicateDoc) {
//           const existingEntry = duplicateDoc.attendance.find(
//             (a) =>
//               a.periods == period &&
//               a.class === className &&
//               a.section === section &&
//               a.semester === semester &&
//               a.subject === subject,
//           );

//           if (existingEntry) {
//             // 🔄 Update existing
//             existingEntry.status = status;
//             existingEntry.unit = unit;
//             existingEntry.description = description;
//             existingEntry.updatedAt = now;
//           } else {
//             // ➕ Create new entry inside attendance array
//             duplicateDoc.attendance.push({
//               periods: period,
//               class: className,
//               section,
//               semester,
//               subject,
//               status,
//               unit,
//               description,
//               teacherId: req.user._id,
//               teacherName: teacherName,
//               createdAt: now,
//               updatedAt: now,
//             });
//           }

//           await duplicateDoc.save();
//         } else {
//           // 🆕 Create whole document
//           await AttendenceDuplicate.create({
//             studentId: id,
//             attendance: [
//               {
//                 periods: period,
//                 class: className,
//                 section,
//                 semester,
//                 subject,
//                 status,
//                 unit,
//                 description,
//                 teacherId: req.user._id,
//                 teacherName: teacherName,
//                 createdAt: now,
//                 updatedAt: now,
//               },
//             ],
//           });
//         }

//         /* =========================================================
//            🔹 2️⃣ ATTENDANCE COLLECTION CHECK
//         ========================================================== */

//         const attendanceDoc = await Attendance.findOne({
//           studentId: id,
//           period: period,
//           subject: subject,
//           date: { $gte: todayStart, $lte: todayEnd },
//         });

//         if (attendanceDoc) {
//           attendanceDoc.status = status;
//           attendanceDoc.unit = unit;
//           attendanceDoc.description = description;
//           attendanceDoc.updatedAt = now;
//           await attendanceDoc.save();
//         } else {
//           await Attendance.create({
//             studentId: id,
//             period,
//             subject,
//             status,
//             unit,
//             description,
//             teacherName: teacherName,
//             date: now,
//             createdAt: now,
//             updatedAt: now,
//           });
//         }

//         updatedCount++;
//       }

//       req.flash(
//         "success",
//         `✅ ${updatedCount} students processed successfully!`,
//       );
//       return res.redirect("/add/student/attendance");
//     } catch (err) {
//       console.error("❌ Error updating attendance:", err);
//       req.flash("error", "Something went wrong!");
//       return res.redirect("/add/student/attendance");
//     }
//   }),
// );

// // Helper for Date String (Timezone Bug-Free)
// const getTodayDateString = () => {
//   const now = new Date();
//   const year = now.getFullYear();
//   const month = String(now.getMonth() + 1).padStart(2, '0');
//   const day = String(now.getDate()).padStart(2, '0');
//   return `${year}-${month}-${day}`;
// };

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
      s.subject.map((sub) =>
        typeof sub === "string" ? sub.trim() : sub.name.trim(),
      ),
    );

    const teacherSubjects = secObj.subjects?.map((sub) => sub.trim()) || [];
    const commonSubjects = teacherSubjects.filter((sub) =>
      studentSubjects.includes(sub),
    );

    if (!commonSubjects.includes(cleanSubject)) {
      req.flash("error", "You are not allowed for this subject");
      return res.redirect("/update/student/attendance");
    }

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
            teacherId: req.user._id,
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

    // Database search based on selected metadata
    const scheduleData = await TimeTable.find({ className, semester, section });

    let groupedTimetable = {};
    let periods = [];

    scheduleData.forEach((slot) => {
      if (!groupedTimetable[slot.day_of_week]) {
        groupedTimetable[slot.day_of_week] = {};
      }

      groupedTimetable[slot.day_of_week][slot.lecture_number] = {
        subject: slot.subject_name || "🍔 LUNCH BREAK",
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

app.get("/logout",  verifySession, isLoggedIn, (req, res, next) => {
  // Clear Passport Local Auth Session
  req.logout((err) => {
    if (err) {
      return next(err);
    }

    // Clear Custom Session Variables
    delete req.session.userId;
    delete req.session.role;
    delete req.session.loginTime;

    req.session.save((saveErr) => {
      if (saveErr) console.error("Teacher Logout Session Save Error:", saveErr);
      req.flash("success", "Logged out successfully!");
      return res.redirect("/student/attendance/login");
    });
  });
});

////////////////////////// teacher folder closed/////////////////////////////////////////////////

//////////////////////////// student folder start//////////////////////////////////////////////

//otp

// app.get("/otp", (req, res) => {
//   const email = req.session.email;
//   res.render("listings/otp.ejs",{email});
// });

// app.post(
//   "/verify-otp",
//   WrapAsync(async (req, res) => {
//     const { otp } = req.body;
//     let otpRecord = await OTP.findOne({ otp: otp });

//     if (otpRecord) {
//       req.session.otpVerified = true;
//       req.flash("success", "Login successfully");
//       return res.redirect("/student/attendance");
//     } else {
//       req.flash("error", "Invalid-OTP!");
//       return res.redirect("/otp");
//     }
//   }),
// );

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

    const scheduleData = await TimeTable.find({ className, semester, section });

    let groupedTimetable = {};
    let periods = [];

    scheduleData.forEach((slot) => {
      if (!groupedTimetable[slot.day_of_week]) {
        groupedTimetable[slot.day_of_week] = {};
      }

      groupedTimetable[slot.day_of_week][slot.lecture_number] = {
        subject: slot.subject_name || "🍔 LUNCH BREAK",
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


app.get("/student/logout",  verifySession, isStudentVerified,(req, res) => {
  // Clear ALL Student Session Variables
  delete req.session.userId;
  delete req.session.studentId;
  delete req.session.rollNo;
  delete req.session.role;
  delete req.session.loginTime;
  delete req.session.otpVerified;

  // Force Save Session to ensure Flash Message is retained
  req.session.save((err) => {
    if (err) console.error("Student Logout Session Save Error:", err);
    req.flash("success", "Logged out successfully!");
    return res.redirect("/student/attendance/login");
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

app.listen(5000, (req, res) => {
  console.log(`All clear ${5000}`);
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
