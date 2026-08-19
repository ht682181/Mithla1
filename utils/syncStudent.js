const mongoose = require("mongoose");
const Marks = require("../models/marksData.js");

// Import exact models exported from feesRecord.js
let FeeLedger, FeeTransaction;
try {
  const feesRecord = require("../models/feesRecord.js");
  FeeLedger = feesRecord.FeeLedger || mongoose.models.FeeLedger;
  FeeTransaction = feesRecord.FeeTransaction || mongoose.models.FeeTransaction;
} catch (err) {
  FeeLedger = mongoose.models.FeeLedger;
  FeeTransaction = mongoose.models.FeeTransaction;
}

/**
 * Sync Student basic details across linked collections using MongoDB Transaction.
 * @param {Object} updatedStudent - The updated student mongoose document or object.
 * @param {mongoose.ClientSession} [externalSession] - Optional existing transaction session.
 */
const syncStudentDetails = async (updatedStudent, externalSession = null) => {
  if (!updatedStudent || !updatedStudent._id) {
    throw new Error("Invalid student object passed to syncStudentDetails");
  }

  // Ensure studentId is a valid ObjectId
  const studentId = new mongoose.Types.ObjectId(updatedStudent._id);
  const rollNo = String(updatedStudent.rollNo);
  const name = updatedStudent.name;
  const fatherName = updatedStudent.fatherName || "";

  let session = externalSession;
  let isInternalSession = false;

  // Handle Session start only if external session isn't supplied
  if (!session) {
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      isInternalSession = true;
    } catch (sessionErr) {
      // Fallback for MongoDB Standalone (No Replica Set configured)
      console.warn("⚠️ MongoDB Transactions not supported (Standalone Mode). Proceeding without transaction.");
      session = null;
      isInternalSession = false;
    }
  }

  const queryOptions = session ? { session } : {};

  try {
    // ----------------------------------------------------
    // 1. SYNC MARKS COLLECTION (Nested Array Matching)
    // ----------------------------------------------------
    await Marks.updateMany(
      { "students.studentId": studentId },
      {
        $set: {
          "students.$[elem].rollNumber": rollNo,
          "students.$[elem].studentName": name,
          "students.$[elem].fatherName": fatherName,
        },
      },
      {
        arrayFilters: [{ "elem.studentId": studentId }],
        ...queryOptions,
      }
    );

    // ----------------------------------------------------
    // 2. SYNC FEE LEDGER COLLECTION (Key: student_id)
    // ----------------------------------------------------
    if (FeeLedger) {
      await FeeLedger.updateMany(
        { student_id: studentId },
        {
          $set: {
            rollNumber: rollNo,
            studentName: name,
            fatherName: fatherName,
          },
        },
        queryOptions
      );
    } else {
      console.warn("⚠️ FeeLedger model not found during sync!");
    }

    // ----------------------------------------------------
    // 3. SYNC FEE TRANSACTIONS COLLECTION (Key: student_id)
    // ----------------------------------------------------
    if (FeeTransaction) {
      await FeeTransaction.updateMany(
        { student_id: studentId },
        {
          $set: {
            rollNumber: rollNo,
            studentName: name,
            fatherName: fatherName,
          },
        },
        queryOptions
      );
    } else {
      console.warn("⚠️ FeeTransaction model not found during sync!");
    }

    // Commit Transaction if opened internally
    if (isInternalSession && session) {
      await session.commitTransaction();
      session.endSession();
    }
  } catch (error) {
    // Abort Transaction if opened internally
    if (isInternalSession && session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error("❌ Error syncing student details across collections:", error);
    throw error;
  }
};

module.exports = syncStudentDetails;