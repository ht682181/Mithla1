const mongoose = require("mongoose");

// Safe Dynamic Imports for Models
let Teacher, TimeTable, Marks, Attendance;

try {
  Teacher = mongoose.models.Teacher || require("../models/teacher.js");
} catch (e) {
  Teacher = mongoose.models.Teacher;
}

try {
  TimeTable = mongoose.models.TimeTable || require("../models/timetable.js");
} catch (e) {
  TimeTable = mongoose.models.TimeTable;
}

try {
  Marks = mongoose.models.Marks || require("../models/marks.js");
} catch (e) {
  Marks = mongoose.models.Marks;
}

try {
  Attendance = mongoose.models.Attendance || require("../models/attendance.js");
} catch (e) {
  Attendance = mongoose.models.Attendance;
}

/**
 * Sync updated Teacher Name across TimeTable, Marks, and Attendance collections.
 * @param {String|mongoose.Types.ObjectId} teacherId - The ObjectId of Teacher Master.
 * @param {Object} updatedData - Object containing updated teacher details like { name }.
 * @param {mongoose.ClientSession} [externalSession] - Optional existing transaction session.
 */
const syncTeacherUpdate = async (teacherId, updatedData, externalSession = null) => {
  if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
    throw new Error("Invalid or missing teacherId for syncTeacherUpdate");
  }

  const tId = new mongoose.Types.ObjectId(teacherId);
  const tIdString = teacherId.toString();
  const { name } = updatedData;

  if (!name || typeof name !== "string" || !name.trim()) return;

  const cleanName = name.trim();

  let session = externalSession;
  let isInternalSession = false;

  if (!session) {
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      isInternalSession = true;
    } catch (sessionErr) {
      console.warn("⚠️ MongoDB Standalone Mode detected. Proceeding without transaction.");
      session = null;
      isInternalSession = false;
    }
  }

  const queryOptions = session ? { session } : {};

  try {
    // 1. UPDATE TIMETABLE TEACHER NAME BY teacher_id
    if (TimeTable) {
      await TimeTable.updateMany(
        { teacher_id: tId },
        { $set: { teacher_name: cleanName } },
        queryOptions
      );
    }

    // 2. UPDATE MARKS TEACHER NAME BY teacherId
    if (Marks) {
      await Marks.updateMany(
        { teacherId: tId },
        { $set: { teacherName: cleanName } },
        queryOptions
      );
    }

    // 3. UPDATE ATTENDANCE TEACHER NAME (Matches both String & ObjectId formats)
    if (Attendance) {
      await Attendance.updateMany(
        {
          $or: [
            { teacherId: tId },
            { teacherId: tIdString }
          ]
        },
        { $set: { teacherName: cleanName } },
        queryOptions
      );
    }

    if (isInternalSession && session) {
      await session.commitTransaction();
      session.endSession();
    }
  } catch (error) {
    if (isInternalSession && session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error("❌ Error syncing teacher updates across collections:", error);
    throw error;
  }
};

/**
 * Handle Teacher Deletion across TimeTable, Marks, and Attendance.
 * @param {String|mongoose.Types.ObjectId} teacherId - The ObjectId of Teacher Master to remove.
 * @param {mongoose.ClientSession} [externalSession] - Optional existing transaction session.
 */
const syncTeacherDelete = async (teacherId, externalSession = null) => {
  if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
    throw new Error("Invalid or missing teacherId for syncTeacherDelete");
  }

  const tId = new mongoose.Types.ObjectId(teacherId);

  let session = externalSession;
  let isInternalSession = false;

  if (!session) {
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      isInternalSession = true;
    } catch (sessionErr) {
      console.warn("⚠️ MongoDB Standalone Mode detected. Proceeding without transaction.");
      session = null;
      isInternalSession = false;
    }
  }

  const queryOptions = session ? { session } : {};

  try {
    // 1. TIMETABLE: Reset teacher fields safely to 'Unassigned' / null to keep schema valid
    if (TimeTable) {
      await TimeTable.updateMany(
        { teacher_id: tId },
        { 
          $unset: { teacher_id: "" },
          $set: { teacher_name: "Unassigned" }
        },
        {
          strict: false,
          validateBeforeSave: false,
          ...queryOptions,
        }
      );
    }

    // 2. MARKS: DELETE ALL MARKS ENTRIES CREATED BY THIS TEACHER
    if (Marks) {
      await Marks.deleteMany(
        { teacherId: tId },
        queryOptions
      );
    }

    // 3. ATTENDANCE: NO DELETE (Attendance fully retained as history)

    if (isInternalSession && session) {
      await session.commitTransaction();
      session.endSession();
    }
  } catch (error) {
    if (isInternalSession && session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error("❌ Error performing sync for teacher deletion:", error);
    throw error;
  }
};

module.exports = {
  syncTeacherUpdate,
  syncTeacherDelete,
};