// const mongoose = require("mongoose");
// const Schema = mongoose.Schema;
// const passportLocalMongoose = require("passport-local-mongoose");

// // 🧩 Define nested schemas

// const sectionSchema = new Schema({
//   section: {
//     type: String,
//     required: true,
//   },
//   subjects: {
//     type: [String],
//     default: [],
//   },

//   temporarySubjects: {
//     type: [String],
//     default: [],
//   },
// });

// const semesterSchema = new Schema({
//   semester: {
//     type: String,
//     required: true,
//   },
//   sections: {
//     type: [sectionSchema],
//     default: [],
//   },
// });

// const classSchema = new Schema({
//   className: {
//     type: String,
//     required: true,
//   },
//   semesters: {
//     type: [semesterSchema],
//     default: [],
//   },
// });

// // 🧑‍🏫 Main Teacher Schema
// const teacherSchema = new Schema({
//   name: {
//     type: String,
//     required: true,
//   },

//   email: {
//     type: String,
//   },

//    status: {
//       type: String,
//       enum: {
//         values: ["Active", "Blocked"],
//         message: "{VALUE} is not a valid status",
//       },
//       default: "Active",
//       index: true, // Speeds up filtering active/blocked accounts
//     },

//     passwordChangedAt: {
//       type: Date,
//       default: Date.now,
//     },

//   mobile: {
//     type: String,
//     required: true,
//   },

//   image:{
//     url:String,
//     filename:String,
//   },

//   // 🔥 Nested class structure
//   class: {
//     type: [classSchema],
//     default: [],
//   },

//   // Optional top-level subjects if you want to track teacher's overall subjects
//   // subject: {
//   //   type: [String],
//   //   default: [],
//   // },
// });

// // 🪪 Add Passport plugin (handles username, password hashing)
// teacherSchema.plugin(passportLocalMongoose);

// // 📦 Export model
// const Teacher = mongoose.model("Teacher", teacherSchema);
// module.exports = Teacher;



const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const passportLocalMongoose = require("passport-local-mongoose");

const subjectSchema = new Schema(
  {
    // 🔗 Actual Subject document ki permanent MongoDB ID
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },

    // 📖 Subject ka current/display name
    subjectName: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    _id: false, // Extra nested _id ki zarurat nahi
  }
);

const sectionSchema = new Schema({
  section: {
    type: String,
    required: true,
  },
  subjects: {
   type: [subjectSchema],
    default: [],
  },
  temporarySubjects: {
    type: [subjectSchema],
    default: [],
  },
});

const semesterSchema = new Schema({
  semester: {
    type: String,
    required: true,
  },
  sections: {
    type: [sectionSchema],
    default: [],
  },
});

const classSchema = new Schema({
  className: {
    type: String,
    required: true,
  },
  semesters: {
    type: [semesterSchema],
    default: [],
  },
});

// 🧑‍🏫 Main Teacher Schema
const teacherSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
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

    // 🔴 Multi-Device Auto Logout Synchronization Timestamp
    passwordChangedAt: {
      type: Date,
      default: Date.now,
    },

    mobile: {
      type: String,
      required: true,
      trim: true,
    },

    image: {
      url: String,
      filename: String,
    },

    // 🔥 Nested class structure
    class: {
      type: [classSchema],
      default: [],
    },
  },
  { timestamps: true } // Auto creates createdAt and updatedAt fields
);

// 🪪 Add Passport plugin (handles username, password hashing - salt & hash)
teacherSchema.plugin(passportLocalMongoose, {
  usernameField: "username", // Default is username
  errorMessages: {
    UserExistsError: "A teacher with the given username is already registered.",
  },
});

// 📦 Export model
const Teacher = mongoose.model("Teacher", teacherSchema);
module.exports = Teacher;