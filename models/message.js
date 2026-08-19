// const mongoose = require("mongoose");
// const Schema = mongoose.Schema;

// const readReceiptSchema = new Schema(
//   {
//     userId: { type: Schema.Types.ObjectId, required: true },
//     role: { type: String, enum: ["Admin", "Teacher", "Student"], required: true },
//     readAt: { type: Date, default: Date.now },
//   },
//   { _id: false }
// );

// const attachmentSchema = new Schema(
//   {
//     url: { type: String, required: true },
//     filename: { type: String, required: true },
//     fileType: { 
//       type: String, 
//       enum: ["image", "document"], 
//       required: true 
//     },
//     originalMime: String,
//   },
//   { _id: false }
// );

// const messageSchema = new Schema(
//   {
//     sender: {
//       id: { type: Schema.Types.ObjectId, required: true },
//       role: {
//         type: String,
//         enum: ["Admin", "Teacher", "Student"],
//         required: true,
//       },
//       name: { type: String, required: true },
//     },

//     recipientRole: {
//       type: String,
//       enum: ["Admin", "Teacher", "Student"],
//       required: true,
//     },

//     audienceType: {
//       type: String,
//       enum: ["all", "filter", "individual"],
//       required: true,
//     },

//     filter: {
//       class: { type: String, trim: true },
//       semester: { type: String, trim: true },
//       section: { type: String, trim: true },
//     },

//     // Standard individual recipient (backward compatible)
//     recipientId: {
//       type: Schema.Types.ObjectId,
//       refPath: "recipientRole",
//       default: null,
//       index: true,
//     },

//     subjectContext: {
//       subjectId: { type: Schema.Types.ObjectId, ref: "Subject" },
//       subjectName: String,
//     },

//     content: {
//       type: String,
//       trim: true,
//       maxlength: [2000, "Message cannot exceed 2000 characters"],
//       default: "",
//     },

//     attachments: [attachmentSchema],

//     parentMessage: {
//       type: Schema.Types.ObjectId,
//       ref: "Message",
//       default: null,
//       index: true,
//     },
//     isReply: { type: Boolean, default: false },

//     isEdited: { type: Boolean, default: false },
//     editedAt: { type: Date, default: null },
//     isDeleted: { type: Boolean, default: false },
//     deletedAt: { type: Date, default: null },

//     readBy: { type: [readReceiptSchema], default: [] },
//   },
//   { timestamps: true }
// );

// messageSchema.index({ recipientRole: 1, audienceType: 1, "filter.class": 1, "filter.semester": 1, "filter.section": 1 });
// messageSchema.index({ recipientRole: 1, recipientId: 1 });
// messageSchema.index({ "sender.id": 1, "sender.role": 1 });
// messageSchema.index({ createdAt: -1 });

// messageSchema.methods.isReadBy = function (userId) {
//   return this.readBy.some((r) => r.userId.toString() === userId.toString());
// };

// const Message = mongoose.model("Message", messageSchema);
// module.exports = Message;


const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Read Receipt Sub-Schema
const readReceiptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: [true, "Read receipt user ID is required"] },
    role: { 
      type: String, 
      enum: { values: ["Admin", "Teacher", "Student"], message: "{VALUE} is not a valid role" }, 
      required: true 
    },
    readAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Attachment Sub-Schema (ADDED public_id FOR CLOUD STORAGE CLEANUP)
const attachmentSchema = new Schema(
  {
    url: { 
      type: String, 
      required: [true, "Attachment URL is required"],
      trim: true 
    },
    public_id: {
      type: String,
      trim: true,
      default: null
    },
    filename: { 
      type: String, 
      required: [true, "Filename is required"],
      trim: true 
    },
    fileType: { 
      type: String, 
      enum: { values: ["image", "document"], message: "{VALUE} is not a valid file type" }, 
      required: true 
    },
    originalMime: {
      type: String,
      trim: true,
      validate: {
        validator: function(v) {
          if (!v) return true;
          const allowedMimes = [
            /^image\/(jpeg|png|webp|gif)$/,
            /^application\/pdf$/,
            /^application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/,
            /^application\/(vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/,
            /^application\/(vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.presentation)$/
          ];
          return allowedMimes.some((regex) => regex.test(v));
        },
        message: "Unsupported file MIME type: {VALUE}"
      }
    },
  },
  { _id: false }
);

// Main Message Schema
const messageSchema = new Schema(
  {
    sender: {
      id: { type: Schema.Types.ObjectId, required: [true, "Sender ID is required"] },
      role: {
        type: String,
        enum: { values: ["Admin", "Teacher", "Student"], message: "{VALUE} is not a valid sender role" },
        required: [true, "Sender role is required"],
      },
      name: { 
        type: String, 
        required: [true, "Sender name is required"],
        trim: true,
        maxlength: [100, "Sender name cannot exceed 100 characters"]
      },
    },

    recipientRole: {
      type: String,
      enum: { values: ["Admin", "Teacher", "Student"], message: "{VALUE} is not a valid recipient role" },
      required: [true, "Recipient role is required"],
    },

    audienceType: {
      type: String,
      enum: { values: ["all", "filter", "individual"], message: "{VALUE} is not a valid audience type" },
      required: [true, "Audience type is required"],
    },

    filter: {
      class: { 
        type: String, 
        trim: true,
        validate: {
          validator: function(v) {
            return this.audienceType !== "filter" || (!!v && v.length > 0);
          },
          message: "Class is required when audience type is 'filter'."
        }
      },
      semester: { 
        type: String, 
        trim: true,
        validate: {
          validator: function(v) {
            return this.audienceType !== "filter" || (!!v && v.length > 0);
          },
          message: "Semester is required when audience type is 'filter'."
        }
      },
      section: { 
        type: String, 
        trim: true,
        validate: {
          validator: function(v) {
            return this.audienceType !== "filter" || (!!v && v.length > 0);
          },
          message: "Section is required when audience type is 'filter'."
        }
      },
    },

    recipientId: {
      type: Schema.Types.ObjectId,
      refPath: "recipientRole",
      default: null,
      index: true,
      validate: {
        validator: function(v) {
          if (this.audienceType === "individual") {
            return v !== null && v !== undefined;
          }
          return true;
        },
        message: "Recipient ID is required when audience type is 'individual'."
      }
    },

    subjectContext: {
      subjectId: { type: Schema.Types.ObjectId, ref: "Subject", default: null },
      subjectName: { type: String, trim: true, default: "" },
    },

    content: {
      type: String,
      trim: true,
      maxlength: [2000, "Message cannot exceed 2000 characters"],
      default: "",
    },

    attachments: {
      type: [attachmentSchema],
      validate: [
        {
          validator: function(val) {
            return val.length <= 5;
          },
          message: "Maximum 5 attachments allowed per message."
        }
      ]
    },

    parentMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
      index: true,
    },
    isReply: { type: Boolean, default: false },

    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    readBy: { type: [readReceiptSchema], default: [] },
  },
  { timestamps: true }
);

// Custom Global Validation Rule
messageSchema.pre("validate", function (next) {
  const hasContent = this.content && this.content.trim().length > 0;
  const hasAttachments = Array.isArray(this.attachments) && this.attachments.length > 0;

  if (!hasContent && !hasAttachments) {
    this.invalidate("content", "Message must contain either text content or at least one attachment.");
  }
  next();
});

// Indexes
messageSchema.index({ recipientRole: 1, audienceType: 1, "filter.class": 1, "filter.semester": 1, "filter.section": 1 });
messageSchema.index({ recipientRole: 1, recipientId: 1 });
messageSchema.index({ "sender.id": 1, "sender.role": 1 });
messageSchema.index({ createdAt: -1 });

// Instance Methods
messageSchema.methods.isReadBy = function (userId) {
  if (!userId) return false;
  return this.readBy.some((r) => r.userId.toString() === userId.toString());
};

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;