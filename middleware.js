

const ExpressError = require("./utils/ExpressError.js");
const Student = require("./models/studentData.js");
const Teacher = require("./models/teacherRecord.js");
const Admin = require("./models/adminSchema.js");

// 🔴 MAIN VERIFY SESSION MIDDLEWARE (Password Change, Block & Session Check)
const verifySession = async (req, res, next) => {
  // 1. Session & Passport Unified Check (Teacher Passport Fallback Added)
  const activeUserId = req.session?.userId || (req.user && req.user._id ? req.user._id.toString() : null);

  if (!activeUserId) {
    req.flash("error", "Please login first!");
    return res.redirect("/student/attendance/login");
  }

  try {
    const userId = activeUserId;
    const userRole = req.session?.role;

    let user = null;

    // 🔴 2. ROLE-BASED DB FETCHING (Fast & Exact)
    const adminRole = process.env.ROLE_1 || "Admin";
    const teacherRole = process.env.ROLE_2 || "Teacher";
    const studentRole = process.env.ROLE_3 || "Student";

    if (userRole === adminRole) {
      user = await Admin.findById(userId);
    } else if (userRole === teacherRole || userRole === "Teacher") {
      user = await Teacher.findById(userId);
    } else if (userRole === studentRole || userRole === "Student") {
      user = await Student.findById(userId);
    } else {
      // Direct Passport user or fallback search
      user = (await Teacher.findById(userId)) ||
             (await Student.findById(userId)) ||
             (await Admin.findById(userId));
    }

    // 🔴 SAFE SESSION & PASSPORT CLEANUP HELPER
    const clearSessionAndLogout = (callback) => {
      // Wiping custom session keys
      delete req.session.userId;
      delete req.session.role;
      delete req.session.loginTime;
      delete req.session.studentId;
      delete req.session.rollNo;
      
      // Wiping Role Specific Verification Flags
      delete req.session.adminVerified;
      delete req.session.otpVerified;

      // Passport.js session cleanup
      if (typeof req.logout === "function") {
        req.logout((err) => {
          if (err) console.error("Passport logout error in middleware:", err);
          return callback();
        });
      } else {
        return callback();
      }
    };

    // 🔴 3. USER NOT FOUND IN DB
    if (!user) {
      return clearSessionAndLogout(() => {
        req.session.save(() => {
          req.flash("error", "Account no longer exists. Please login again.");
          return res.redirect("/student/attendance/login");
        });
      });
    }

    // 🔴 4. BLOCKED USER IMMEDIATE REVOCATION
    if (user.status === "Blocked") {
      return clearSessionAndLogout(() => {
        req.session.save(() => {
          req.flash(
            "error",
            "Your account has been blocked by administrator. Access revoked."
          );
          return res.redirect("/student/attendance/login");
        });
      });
    }

    // 🔴 5. BULLETPROOF TIMESTAMP CHECK FOR MULTI-DEVICE AUTO LOGOUT
    // (Strictly check if the logged-in entity's password was changed)
    if (user.passwordChangedAt && req.session.loginTime) {
      const passwordChangedTime = new Date(user.passwordChangedAt).getTime();
      const sessionLoginTime = new Date(req.session.loginTime).getTime();

      // Ensure that only the user whose password actually changed is logged out
      if (sessionLoginTime < passwordChangedTime - 1000) {
        return clearSessionAndLogout(() => {
          req.session.save((err) => {
            if (err) console.error("Session Save Error in Middleware:", err);
            req.flash(
              "error",
              "Password was recently changed. Please login again with your new password."
            );
            return res.redirect("/student/attendance/login");
          });
        });
      }
    }

    // Attach user instance to request & locals
    req.user = user;
    res.locals.curruser = user;
    next();
  } catch (err) {
    console.error("verifySession Middleware Error:", err);
    req.flash("error", "Authentication error. Please login again.");
    return res.redirect("/student/attendance/login");
  }
};



// =========================================================================
const isStudentVerified = (req, res, next) => {
  const studentRole = process.env.ROLE_3 || "Student";

  // Check 1: Strict Role Verification
  if (!req.session || (req.session.role !== studentRole && req.session.role !== "Student")) {
    req.flash("error", "Unauthorized! Student access required.");
    return res.redirect("/student/attendance/login");
  }

  // Check 2: First Time Password Update / OTP Verification Check
  if (!req.session.otpVerified) {
    req.flash("error", "Please complete password update / OTP verification first.");
    return res.redirect("/student/update/password");
  }

  next();
};


// =========================================================================
// 🛡️ 3. STRICT TEACHER GUARD MIDDLEWARE
// =========================================================================
const isLoggedIn = (req, res, next) => {
  const teacherRole = process.env.ROLE_2 || "Teacher";

  const isTeacherRole = req.session && req.session.role === teacherRole;
  const isPassportAuth = typeof req.isAuthenticated === "function" ? req.isAuthenticated() : false;

  // STRICT CHECK: Both conditions MUST be true (Teacher Role AND Active Passport Session)
  if (!isTeacherRole || !isPassportAuth) {
    req.flash("error", "Unauthorized! Only Teachers can access this page.");
    return res.redirect("/student/attendance/login");
  }

  next();
};
// =========================================================================
// 4. 👑 ADMIN GUARD (Role + Verification Flag Check)
// =========================================================================
const isAdminVerified = (req, res, next) => {
  const adminRole = process.env.ROLE_1 || "Admin";

  if (
    !req.session || 
    (req.session.role !== adminRole && req.session.role !== "Admin") || 
    req.session.adminVerified !== true
  ) {
    req.flash("error", "Unauthorized! Admin access required.");
    return res.redirect("/student/attendance/login");
  }

  next();
};

module.exports = {
  verifySession,
  isStudentVerified,
  isLoggedIn,
  isAdminVerified
};

// 🔴 2. SIMPLE ISLOGGEDIN MIDDLEWARE (Uses req.user or res.locals)
// const isLoggedIn = (req, res, next) => {
//   if (!res.locals.curruser && !req.session.userId) {
//     req.flash("error", "You must be logged in first.");
//     return res.redirect("/student/attendance/login");
//   }
//   next();
// };




// module.exports = {
//   verifySession,
//   isLoggedIn,
// };
