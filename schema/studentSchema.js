const Joi = require("joi");
const ExpressError = require("../utils/ExpressError");

const studentValidationSchema = Joi.object({
  data:Joi.object({
  rollNo: Joi.number().required().messages({
    "number.base": "Roll No must be a number",
    "any.required": "Roll No is required",
  }),

  name: Joi.string().required().messages({
    "string.base": "Name must be a string",
    "any.required": "Name is required",
  }),

  fatherName: Joi.string().required().messages({
    "string.base": "Father name must be a string",
    "any.required": "Father name is required",
  }),

  section: Joi.string().required().messages({
    "any.required": "Section is required",
  }),

  class: Joi.string().required().messages({
    "any.required": "Class is required",
  }),

  session: Joi.string().required().messages({
    "any.required": "Session is required",
  }),

  semester: Joi.string().required().messages({
    "any.required": "Semester is required",
  }),

  // email: Joi.string().email().required().messages({
  //   "string.email": "Invalid email format",
  //   "any.required": "Email is required",
  // }),

  email: Joi.string()
  .email()
  .optional()
  .allow(null, "")
  .messages({
    "string.email": "Invalid email format"
  }),


  image: Joi.object({
    url: Joi.string().allow("", null),
    filename: Joi.string().allow("", null),
  }).optional(),

   password: Joi.string()
      .allow("", null)        // empty ya null allowed
      .min(6)                 // agar value hai, toh minimum 6 char
      .optional()
      .messages({
        "string.min": "Password must be at least 6 characters",
      }),  


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
        subjectType: Joi.string().valid("Theory", "Practical", "Both").required(),
      })
    )
    .optional(), 
   
  createdAt: Joi.date().optional(),

  expireAt: Joi.date().optional(),
}).required(),
});



const validateStudent = (req, res, next) => {
  const { error } = studentValidationSchema.validate(req.body);

 if (error) {
    const msg = error.details.map((e) => e.message).join(",");
    return next(new ExpressError(400,msg));
  }

  next();
};

module.exports = validateStudent;
