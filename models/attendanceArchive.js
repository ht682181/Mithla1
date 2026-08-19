const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const attendanceArchiveSchema = new Schema({
  // Live attendance ki id ka track rakhne ke liye
  originalAttendanceId: { type: Schema.Types.ObjectId, required: true },
  
  // Jis student ki attendance hai uski original id
  studentId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  date: { type: Date, required: true },
  status: String,
  period: Number,
  subject: String,
  unit: String,
  description: String,
  class:String,
  teacherName: String,
  teacherId: String,
  archivedAt: { type: Date, default: Date.now }
});

// Fast indexing taaki agar baad me kisi student ki attendance archive se nikalni ho toh turant mile
attendanceArchiveSchema.index({ studentId: 1, date: -1 });

module.exports = mongoose.model("AttendanceArchive", attendanceArchiveSchema);