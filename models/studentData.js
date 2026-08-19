// const mongoose = require("mongoose");
// const Schema = mongoose.Schema;

// const studentSchema = new Schema({
//   rollNo: { type: Number, required: true ,unique:true},
//   password:{type:String},
//   name: { type: String, required: true },
//   fatherName: { type: String, required: true },
//   section: { type: String, required: true },
//   class: { type: String, required: true },
//   session: { type: String, required: true },
//   semester: { type: String, required: true },
//   email: { type: String, },
//   image: {
//     url: String,
//     filename: String
//   },
//   check:{type:String},
//  subject: [
//     {
//       name: String,
//       code: String,
//       maxMarks: Number,
//       minMarks: Number,
//       subjectType: String,
//     },
//   ],
   
//   createdAt: {
//     type: Date,
//     default: Date.now,
//   },

//   // expireAt: {
//   //   type: Date,
//   // },
// });

// /* 🔥 THIS IS MANDATORY — TTL INDEX */
// // studentSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });


// studentSchema.post("findOneAndDelete", async function (doc) {
//   if (doc) {
//     await mongoose.model("Attendance").deleteMany({
//       studentId: doc._id
//     });

//     console.log(`🧹 Attendance deleted for student ${doc._id}`);
//   }
// });

// const Student = mongoose.model("Student", studentSchema);
// module.exports = Student;



const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const bcrypt = require("bcrypt");

const studentSchema = new Schema(
  {
    rollNo: {
      type: Number,
      required: [true, "Admin number is required"],
      unique: true,
      index: true,
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      maxlength: [100, "Password cannot exceed 100 characters"],
      select: false, // Prevents password leaking in default queries
    },

    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [80, "Name cannot exceed 80 characters"],
    },

    fatherName: {
      type: String,
      required: [true, "Father name is required"],
      trim: true,
      maxlength: [80, "Father name cannot exceed 80 characters"],
    },

    section: {
      type: String,
      required: [true, "Section is required"],
      trim: true,
    },

    class: {
      type: String,
      required: [true, "Class is required"],
      trim: true,
    },

    session: {
      type: String,
      required: [true, "Session is required"],
      trim: true,
    },

    semester: {
      type: String,
      required: [true, "Semester is required"],
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [100, "Email cannot exceed 100 characters"],
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
    },

    image: {
      url: String,
      filename: String,
    },

    status: {
      type: String,
      enum: {
        values: ["Active", "Blocked"],
        message: "{VALUE} is not a valid status",
      },
      default: "Active",
      index: true, // Speeds up filtering active/blocked accounts
    },

    passwordChangedAt: {
      type: Date,
      default: Date.now,
    },

    check: {
      type: String,
      trim: true,
    },

    subject: [
      
        {
    subjectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subject",
        required: true,
      },
        name: String,
        code: String,
        maxMarks: Number,
        minMarks: Number,
        subjectType: String,
      },
    ],
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt fields
  }
);

// ================= PRE-SAVE HOOK (PASSWORD HASHING) =================
studentSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);

    // Update timestamp only if existing document password is modified
    if (!this.isNew) {
      this.passwordChangedAt = new Date();
    }

    next();
  } catch (err) {
    next(err);
  }
});

// ================= INSTANCE METHODS =================

// 1. Compare Password Method
studentSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) {
    throw new Error(
      "Password field is missing. Did you forget to call .select('+password')?"
    );
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// 2. Helper Method for Updating Password Changed Timestamp
studentSchema.methods.updatePasswordChangedAt = function () {
  this.passwordChangedAt = new Date();
  return this.save({ validateBeforeSave: false });
};

const Student = mongoose.model("Student", studentSchema);
module.exports = Student;


