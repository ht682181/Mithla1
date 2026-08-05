// const Joi = require("joi");
// const ExpressError = require("../utils/ExpressError");

// const studentValidationSchema = Joi.object({
//   data:Joi.object({
//   rollNo: Joi.number().required().messages({
//     "number.base": "Roll No must be a number",
//     "any.required": "Roll No is required",
//   }),

//   name: Joi.string().required().messages({
//     "string.base": "Name must be a string",
//     "any.required": "Name is required",
//   }),

//   fatherName: Joi.string().required().messages({
//     "string.base": "Father name must be a string",
//     "any.required": "Father name is required",
//   }),

//   section: Joi.string().required().messages({
//     "any.required": "Section is required",
//   }),

//   class: Joi.string().required().messages({
//     "any.required": "Class is required",
//   }),

//   session: Joi.string().required().messages({
//     "any.required": "Session is required",
//   }),

//   semester: Joi.string().required().messages({
//     "any.required": "Semester is required",
//   }),

//   // email: Joi.string().email().required().messages({
//   //   "string.email": "Invalid email format",
//   //   "any.required": "Email is required",
//   // }),

//   email: Joi.string()
//   .email()
//   .optional()
//   .allow(null, "")
//   .messages({
//     "string.email": "Invalid email format"
//   }),


//   image: Joi.object({
//     url: Joi.string().allow("", null),
//     filename: Joi.string().allow("", null),
//   }).optional(),

//    password: Joi.string()
//       .allow("", null)        // empty ya null allowed
//       .min(8)                 // agar value hai, toh minimum 6 char
//       .optional()
//       .messages({
//         "string.min": "Password must be at least 8 characters",
//       }),  


//   subject: Joi.array()
//     .items(
//       Joi.object({
//         name: Joi.string().required().messages({
//           "any.required": "Subject name is required",
//         }),
//         code: Joi.string().required().messages({
//           "any.required": "Subject code is required",
//         }),
//         maxMarks: Joi.number().required().messages({
//           "any.required": "Max marks are required",
//         }),
//         minMarks: Joi.number().required().messages({
//           "any.required": "Min marks are required",
//         }),
//         subjectType: Joi.string().valid("Theory", "Practical", "Both").required(),
//       })
//     )
//     .optional(), 
   
//   createdAt: Joi.date().optional(),

//   expireAt: Joi.date().optional(),
// }).required(),
// });



// const validateStudent = (req, res, next) => {
//   const { error } = studentValidationSchema.validate(req.body);

//  if (error) {
//     const msg = error.details.map((e) => e.message).join(",");
//     return next(new ExpressError(400,msg));
//   }

//   next();
// };

// module.exports = validateStudent;



const Joi = require("joi");
const ExpressError = require("../utils/ExpressError");

const studentValidationSchema = Joi.object({
  data: Joi.object({
    rollNo: Joi.number().required().messages({
      "number.base": "Roll No must be a valid number",
      "any.required": "Roll No is required",
    }),

    name: Joi.string().trim().max(80).required().messages({
      "string.base": "Name must be a string",
      "string.max": "Name cannot exceed 80 characters",
      "any.required": "Name is required",
    }),

    fatherName: Joi.string().trim().max(80).required().messages({
      "string.base": "Father name must be a string",
      "string.max": "Father name cannot exceed 80 characters",
      "any.required": "Father name is required",
    }),

    section: Joi.string().trim().required().messages({
      "any.required": "Section is required",
    }),

    class: Joi.string().trim().required().messages({
      "any.required": "Class is required",
    }),

    session: Joi.string().trim().required().messages({
      "any.required": "Session is required",
    }),

    semester: Joi.string().trim().required().messages({
      "any.required": "Semester is required",
    }),

    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .optional()
      .allow(null, "")
      .messages({
        "string.email": "Please enter a valid email address",
      }),

    image: Joi.object({
      url: Joi.string().allow("", null),
      filename: Joi.string().allow("", null),
    }).optional(),

    // 🔴 FIX: Password empty string allow tabhi kare jab editing ho, create ke waqt valid password aaye
    password: Joi.string()
      .min(8)
      .max(100)
      .optional()
      .allow(null, "")
      .messages({
        "string.min": "Password must be at least 8 characters long",
        "string.max": "Password cannot exceed 100 characters",
      }),

    // 🔴 NEW: Status Validation (Active/Blocked)
    status: Joi.string()
      .valid("Active", "Blocked")
      .default("Active")
      .optional()
      .messages({
        "any.only": "Status must be either Active or Blocked",
      }),

    check: Joi.string().trim().optional().allow("", null),

    subject: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().required().messages({
            "any.required": "Subject name is required",
          }),
          code: Joi.string().required().messages({
            "any.required": "Subject code is required",
          }),
          maxMarks: Joi.number().required().messages({
            "any.required": "Max marks are required",
          }),
          minMarks: Joi.number().required().messages({
            "any.required": "Min marks are required",
          }),
          subjectType: Joi.string()
            .valid("Theory", "Practical", "Both")
            .required()
            .messages({
              "any.only": "Subject type must be Theory, Practical, or Both",
            }),
        })
      )
      .optional(),

    passwordChangedAt: Joi.date().optional(),
    createdAt: Joi.date().optional(),
    updatedAt: Joi.date().optional(),
  }).required(),
});

const validateStudent = (req, res, next) => {
  const { error } = studentValidationSchema.validate(req.body);

  if (error) {
    const msg = error.details.map((e) => e.message).join(", ");
    return next(new ExpressError(400, msg));
  }

  next();
};

module.exports = validateStudent;