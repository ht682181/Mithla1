const mongoose = require("mongoose");

const classInchargeSchema = new mongoose.Schema(
  {
    className: {
      type: String,
      required: [true, "Class Name is required"],
      trim: true,
      uppercase: true,
    },
    semester: {
      type: String,
      required: [true, "Semester is required"],
      trim: true,
      uppercase: true,
    },
    sectionName: {
      type: String,
      required: [true, "Section Name is required"],
      trim: true,
      uppercase: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: [true, "Teacher is required"],
    },
  },
  {
    timestamps: true,
  }
);

// Unique Index: Class + Semester + Section
classInchargeSchema.index(
  { className: 1, semester: 1, sectionName: 1 },
  { unique: true, name: "unique_class_semester_section" }
);

// Unique Index: One Teacher = One Class Incharge Assignment
classInchargeSchema.index(
  { teacher: 1 },
  { unique: true, name: "unique_teacher_class_incharge" }
);

module.exports = mongoose.model("ClassIncharge", classInchargeSchema);