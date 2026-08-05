const mongoose = require("mongoose");

// Individual Exam Sub-Schema
const subExamSchema = new mongoose.Schema({
  examName: {
    type: String,
    required: [true, "Exam name is required (e.g., MID-TERM, SESSIONAL)"],
    trim: true,
    uppercase: true, // 🔠 Automatically converts to UPPERCASE (e.g., "mid-term" -> "MID-TERM")
  },
  maxMarks: {
    type: Number,
    required: [true, "Maximum marks are required"],
    min: [1, "Maximum marks must be at least 1"],
  },
  passingMarks: {
    type: Number,
    required: [true, "Passing marks are required"],
    min: [0, "Passing marks cannot be negative"],
  },
});

// Parent Schema grouped by Class, Semester, Section, and Academic Year
const examConfigSchema = new mongoose.Schema(
  {
    className: {
      type: String,
      required: [true, "Class name is required (e.g., BCA, BTECH)"],
      trim: true,
      uppercase: true,
    },
    semester: {
      type: Number,
      required: [true, "Semester is required"],
      min: [1, "Semester must be at least 1"],
      max: [10, "Semester cannot exceed 10"],
    },
    section: {
      type: String,
      required: [true, "Section is required (e.g., A, B, C)"],
      trim: true,
      uppercase: true,
    },
    // academicYear: {
    //   type: Number,
    //   required: [true, "Academic year is required"],
    //   min: [2000, "Invalid academic year"],
    //   max: [2100, "Invalid academic year"],
    // },
    academicYear: {
  type: String,
  required: [true, "Academic year / Session is required"],
  trim: true,
  // 🔍 Regex pattern: Ensures format like "2025-2028" or "2025-28"
  validate: {
    validator: function (v) {
      return /^\d{4}-\d{2,4}$/.test(v); // Validates "2025-2028" OR "2025-28"
    },
    message: (props) => `${props.value} is not a valid format! Use 'YYYY-YYYY' (e.g. 2025-2028)`,
  },
},
    
    // Array to hold multiple exams for this combination
    exams: [subExamSchema],
  },
  {
    timestamps: true,
  }
);

// 🔒 Unique Compound Index (Prevents duplicate group entries)
examConfigSchema.index(
  { className: 1, semester: 1, section: 1, academicYear: 1 },
  { unique: true }
);

module.exports = mongoose.model("ExamConfig", examConfigSchema);