const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const bcrypt = require("bcrypt");

const adminSchema = new Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username cannot exceed 30 characters"],
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
      required: [true, "Full name is required"],
      trim: true,
      maxlength: [80, "Full name cannot exceed 80 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: [100, "Email cannot exceed 100 characters"],
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
    },

    mobile: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          if (!v || v === "") return true; // Allows optional empty string
          return /^[6-9]\d{9}$/.test(v); // 10-digit Indian Mobile Regex
        },
        message: "Please enter a valid 10-digit mobile number",
      },
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

    lastLogin: {
      type: Date,
      default: null,
    },

    passwordChangedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-Save Hook: Password Hashing & Timestamp Tracking
adminSchema.pre("save", async function (next) {
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

// Compare Password Instance Method
adminSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) {
    throw new Error(
      "Password field is missing. Did you forget to call .select('+password')?"
    );
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Update Last Login Helper Method
adminSchema.methods.updateLastLogin = function () {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

module.exports = mongoose.model("Admin", adminSchema);