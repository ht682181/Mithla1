const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * NOTIFICATION MODEL
 * Har message ke liye recipient(s) ke against ek notification record.
 * - Socket.io khula tab -> real time deliver + isDelivered:true
 * - Socket band tab -> pending rehta hai, login/reconnect par fetch karke dikha denge
 */
const notificationSchema = new Schema(
  {
    recipientId: { type: Schema.Types.ObjectId, required: true, index: true },
    recipientRole: {
      type: String,
      enum: ["Admin", "Teacher", "Student"],
      required: true,
    },
    message: { type: Schema.Types.ObjectId, ref: "Message", required: true },
    title: { type: String, required: true },
    preview: { type: String, trim: true, maxlength: 200 },
    isRead: { type: Boolean, default: false },
    isDelivered: { type: Boolean, default: false }, // real-time socket delivery hui ya nahi
  },
  { timestamps: true }
);

notificationSchema.index({ recipientId: 1, recipientRole: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
