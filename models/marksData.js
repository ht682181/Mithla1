const mongoose = require("mongoose");

const studentMarkSchema = new mongoose.Schema({
  studentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Student", 
    required: [true, "Student ID is required"] 
  },
  rollNumber: { 
    type: String, 
    required: [true, "Roll number is required"],
    trim: true 
  },
  studentName: { 
    type: String, 
    required: [true, "Student name is required"],
    trim: true 
  },
  fatherName: { 
    type: String, 
    trim: true,
    default: "" 
  },
  obtainedMarks: { 
    type: Number, 
    required: [true, "Obtained marks are required"], 
    min: [0, "Marks cannot be negative"] 
  },
  attendanceStatus: { 
    type: String, 
    enum: {
      values: ["Present", "Absent"],
      message: "Attendance must be either Present or Absent"
    },
    default: "Present" 
  },
  remarks: { 
    type: String, 
    trim: true,
    maxlength: [150, "Remarks cannot exceed 150 characters"],
    default: "" 
  },
  updatedAt: { type: Date, default: Date.now }
});

const marksSchema = new mongoose.Schema({
  // academicYear: { 
  //   type: Number, 
  //   required: [true, "Academic Year is required"],
  //   min: [2000, "Invalid Academic Year"],
  //   max: [2100, "Invalid Academic Year"]
  // },

  academicYear: {
  type: String,
  required: [true, "Academic Year / Session is required"],
  trim: true,
  validate: {
    validator: function (v) {
      // Validates formats like "2025-2028" or "2025-28"
      return /^\d{4}-\d{2,4}$/.test(v);
    },
    message: (props) => `${props.value} is not a valid session format! Use format like '2025-2028'`,
  },
},

  className: { type: String, required: [true, "Class Name is required"], trim: true },
  semester: { type: Number, required: [true, "Semester is required"], min: 1 },
  section: { type: String, required: [true, "Section is required"], trim: true },
  subject: { type: String, required: [true, "Subject is required"], trim: true },
  examName: { type: String, required: [true, "Exam Name is required"], trim: true,uppercase:true },
  examType: { type: String, required: [true, "Exam Type is required"], trim: true },
  maxMarks: { type: Number, required: [true, "Max Marks is required"], min: [1, "Max marks must be > 0"] },
  passMarks: { type: Number, required: [true, "Pass Marks is required"], min: [0, "Pass marks cannot be negative"] },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
  teacherName: { type: String, required: true },
  status: { type: String, enum: ["OPEN", "LOCKED"], default: "OPEN" },
  students: {
    type: [studentMarkSchema],
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length > 0;
      },
      message: "At least one student mark record is required."
    }
  }
}, { timestamps: true });

// 🔒 CRASH & DUPLICATE PROOF INDEX
marksSchema.index({
  academicYear: 1,
  className: 1,
  semester: 1,
  section: 1,
  subject: 1,
  examName: 1
}, { unique: true });

module.exports = mongoose.model("Marks", marksSchema);