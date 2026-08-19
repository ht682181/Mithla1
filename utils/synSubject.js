const mongoose = require("mongoose");

// Safe Dynamic Imports for Models
let Student, Teacher, Subject, TimeTable;
try {
  Student = mongoose.models.Student || require("../models/student.js");
} catch (e) {
  Student = mongoose.models.Student;
}

try {
  Teacher = mongoose.models.Teacher || require("../models/teacher.js");
} catch (e) {
  Teacher = mongoose.models.Teacher;
}

try {
  Subject = mongoose.models.Subject || require("../models/subject.js");
} catch (e) {
  Subject = mongoose.models.Subject;
}

try {
  TimeTable = mongoose.models.TimeTable || require("../models/timetable.js");
} catch (e) {
  TimeTable = mongoose.models.TimeTable;
}

/**
 * Sync updated Subject details across Student, Teacher, and TimeTable collections.
 * @param {String|mongoose.Types.ObjectId} subjectId - The ObjectId of Subject Master.
 * @param {Object} updatedData - Updated subject fields.
 * @param {mongoose.ClientSession} [externalSession] - Optional existing transaction session.
 */
const syncSubjectUpdate = async (subjectId, updatedData, externalSession = null) => {
  if (!subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
    throw new Error("Invalid or missing subjectId for syncSubjectUpdate");
  }

  const sId = new mongoose.Types.ObjectId(subjectId);
  const { name, code, maxMarks, minMarks, subjectType } = updatedData;

  let session = externalSession;
  let isInternalSession = false;

  // Handle Session initialization ONLY if externalSession is not passed
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
    // ------------------------------------------------------------------
    // 1. UPDATE STUDENTS ARRAY BY subjectId MATCHING
    // ------------------------------------------------------------------
    const studentUpdateFields = {};
    if (name !== undefined) studentUpdateFields["subject.$[elem].name"] = name;
    if (code !== undefined) studentUpdateFields["subject.$[elem].code"] = code;
    if (maxMarks !== undefined) studentUpdateFields["subject.$[elem].maxMarks"] = Number(maxMarks);
    if (minMarks !== undefined) studentUpdateFields["subject.$[elem].minMarks"] = Number(minMarks);
    if (subjectType !== undefined) studentUpdateFields["subject.$[elem].subjectType"] = subjectType;

    if (Object.keys(studentUpdateFields).length > 0 && Student) {
      await Student.updateMany(
        { "subject.subjectId": sId },
        { $set: studentUpdateFields },
        {
          arrayFilters: [{ "elem.subjectId": sId }],
          strict: false,
          ...queryOptions,
        }
      );
    }

    // ------------------------------------------------------------------
    // 2. UPDATE TEACHERS NESTED SUBJECTS & TEMPORARY SUBJECTS
    // ------------------------------------------------------------------
    if (Teacher && name !== undefined) {
      // 2a. Sync permanent subjects in class -> semesters -> sections -> subjects
      await Teacher.updateMany(
        { "class.semesters.sections.subjects.subjectId": sId },
        { $set: { "class.$[].semesters.$[].sections.$[].subjects.$[sub].subjectName": name } },
        {
          arrayFilters: [{ "sub.subjectId": sId }],
          strict: false,
          ...queryOptions,
        }
      );

      // 2b. Sync temporary subjects in class -> semesters -> sections -> temporarySubjects
      await Teacher.updateMany(
        { "class.semesters.sections.temporarySubjects.subjectId": sId },
        { $set: { "class.$[].semesters.$[].sections.$[].temporarySubjects.$[tempSub].subjectName": name } },
        {
          arrayFilters: [{ "tempSub.subjectId": sId }],
          strict: false,
          ...queryOptions,
        }
      );
    }

    // ------------------------------------------------------------------
    // 3. UPDATE TIMETABLE SUBJECT NAMES BY subject_id MATCHING
    // ------------------------------------------------------------------
    if (TimeTable && name !== undefined) {
      await TimeTable.updateMany(
        { subject_id: sId },
        { $set: { subject_name: name } },
        queryOptions
      );
    }

    // Only commit/end if this function initiated the session
    if (isInternalSession && session) {
      await session.commitTransaction();
      session.endSession();
    }
  } catch (error) {
    if (isInternalSession && session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error("❌ Error syncing subject updates across collections:", error);
    throw error;
  }
};

/**
 * Remove/Clean deleted Subject references across Student, Teacher, and TimeTable collections.
 * @param {String|mongoose.Types.ObjectId} subjectId - The ObjectId of Subject Master to remove.
 * @param {mongoose.ClientSession} [externalSession] - Optional existing transaction session.
 */
const syncSubjectDelete = async (subjectId, externalSession = null) => {
  if (!subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
    throw new Error("Invalid or missing subjectId for syncSubjectDelete");
  }

  const sId = new mongoose.Types.ObjectId(subjectId);

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
    // ------------------------------------------------------------------
    // 1. REMOVE FROM STUDENTS
    // ------------------------------------------------------------------
    if (Student) {
      await Student.updateMany(
        { "subject.subjectId": sId },
        { $pull: { subject: { subjectId: sId } } },
        queryOptions
      );
    }

    // ------------------------------------------------------------------
    // 2. REMOVE FROM TEACHERS (Nested in Sections) & CLEAN GHOST ENTRIES
    // ------------------------------------------------------------------
    if (Teacher) {
      // Step 2a: Pull permanent subjects
      await Teacher.updateMany(
        { "class.semesters.sections.subjects.subjectId": sId },
        { $pull: { "class.$[].semesters.$[].sections.$[].subjects": { subjectId: sId } } },
        queryOptions
      );

      // Step 2b: Pull temporary subjects
      await Teacher.updateMany(
        { "class.semesters.sections.temporarySubjects.subjectId": sId },
        { $pull: { "class.$[].semesters.$[].sections.$[].temporarySubjects": { subjectId: sId } } },
        queryOptions
      );

      // Step 2c: Safe In-Memory Ghost Cleaning (Guaranteed No DB Wildcard Errors)
      const affectedTeachers = await Teacher.find(
        {
          $or: [
            { "class.semesters.sections.subjects": { $size: 0 } },
            { "class.semesters.sections.temporarySubjects": { $size: 0 } },
            { "class.semesters.sections": { $size: 0 } },
            { "class.semesters": { $size: 0 } }
          ]
        },
        null,
        queryOptions
      );

      for (const teacherDoc of affectedTeachers) {
        let modified = false;

        teacherDoc.class = teacherDoc.class.filter((cls) => {
          cls.semesters = cls.semesters.filter((sem) => {
            sem.sections = sem.sections.filter((sec) => {
              // Keeping section ONLY IF either subjects or temporarySubjects has items
              const hasSubjects = sec.subjects && sec.subjects.length > 0;
              const hasTempSubjects = sec.temporarySubjects && sec.temporarySubjects.length > 0;
              return hasSubjects || hasTempSubjects;
            });
            // Keep semester ONLY IF sections are remaining
            return sem.sections.length > 0;
          });
          // Keep class ONLY IF semesters are remaining
          return cls.semesters.length > 0;
        });

        // Mark nested array modified for Mongoose change tracking
        teacherDoc.markModified("class");
        await teacherDoc.save(queryOptions);
      }
    }

    // ------------------------------------------------------------------
    // 3. REMOVE ONLY subject_id AND subject_name FIELDS FROM TIMETABLE
    // ------------------------------------------------------------------
    if (TimeTable) {
      await TimeTable.updateMany(
        { subject_id: sId },
        { $unset: { subject_id: "", subject_name: "" } },
        {
          strict: false,
          validateBeforeSave: false,
          ...queryOptions
        }
      );
    }

    // Only commit/end if this function initiated the session
    if (isInternalSession && session) {
      await session.commitTransaction();
      session.endSession();
    }
  } catch (error) {
    if (isInternalSession && session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error("❌ Error deleting subject references across collections:", error);
    throw error;
  }
};

module.exports = {
  syncSubjectUpdate,
  syncSubjectDelete,
};