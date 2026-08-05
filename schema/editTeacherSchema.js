// const Joi = require("joi");
// const ExpressError = require("../utils/ExpressError.js");


// const editTeacherSchema = Joi.object({
//   data:Joi.object({

//     name: Joi.string().required(),
//   // email: Joi.string().email().required(),
//    email: Joi.string()
//       .email()
//       .optional()
//       .allow(null, "")
//       .messages({
//         "string.email": "Invalid email format"
//       }),
//   mobile: Joi.string()
//     .pattern(/^[0-9]{10}$/)
//     .required()
//     .messages({
//       "string.pattern.base": "Mobile number must be exactly 10 digits",
//     }),
//   username: Joi.string().required(),
//    password: Joi.string()
//   .allow("", null)        // empty ya null allowed
//   .min(6)                 // agar value hai, toh minimum 6 char
//   .optional()
//   .messages({
//     "string.min": "Password must be at least 6 characters",
//   }),

//   image: Joi.any().optional(), // multer handles file
//   class: Joi.array().optional(),
//   subject: Joi.array().optional(),

//   }).required(),
// });

// const validateTeacherEdit = (req, res, next) => {
//   const { error } = editTeacherSchema.validate(req.body);

//  if (error) {
//     const msg = error.details.map((e) => e.message).join(",");
//     return next(new ExpressError(400,msg));
//   }

//   next();
// };

// module.exports = validateTeacherEdit

const Joi = require("joi");
const ExpressError = require("../utils/ExpressError.js");

const editTeacherSchema = Joi.object({
  data: Joi.object({
    name: Joi.string().trim().required().messages({
      "any.required": "Name is required",
    }),

    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .optional()
      .allow(null, "")
      .messages({
        "string.email": "Invalid email format",
      }),

    mobile: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .required()
      .messages({
        "string.pattern.base": "Mobile number must be exactly 10 digits",
        "any.required": "Mobile number is required",
      }),

    username: Joi.string().trim().required().messages({
      "any.required": "Username is required",
    }),

    password: Joi.string()
      .allow("", null) // Optional/Empty during edit
      .min(8) // Standard 8 chars minimum
      .optional()
      .messages({
        "string.min": "Password must be at least 8 characters",
      }),

    // 🔴 Added: Teacher status edit check (Active / Blocked)
    status: Joi.string()
      .valid("Active", "Blocked")
      .optional()
      .messages({
        "any.only": "Status must be either Active or Blocked",
      }),

    image: Joi.any().optional(), // multer handles file
    class: Joi.array().optional(),
    subject: Joi.array().optional(),
  }).required(),
});

const validateTeacherEdit = (req, res, next) => {
  const { error } = editTeacherSchema.validate(req.body);

  if (error) {
    const msg = error.details.map((e) => e.message).join(",");
    return next(new ExpressError(400, msg));
  }

  next();
};

module.exports = validateTeacherEdit;