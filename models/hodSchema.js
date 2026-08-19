const mongoose = require("mongoose");

const hodSchema = new mongoose.Schema(
  {
    courseName: {
      type: String,
      required: [true, "Course Name is required"],
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

// Unique Index: One Course = One HOD
hodSchema.index(
  { courseName: 1 },
  { unique: true, name: "unique_hod_course" }
);

// Unique Index: One Teacher = One HOD Assignment
hodSchema.index(
  { teacher: 1 },
  { unique: true, name: "unique_teacher_hod" }
);

module.exports = mongoose.model("Hod", hodSchema);