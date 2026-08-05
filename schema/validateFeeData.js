// const Joi = require('joi');

// // 🛡️ Tamper Proof Schema (Strict Index Mapping)
// const feeBulkSchema = Joi.object({
//   className: Joi.string().required(),
//   section: Joi.string().required(),
//   semA: Joi.number().integer().min(1).max(8).required(),
//   semB: Joi.number().integer().min(1).max(8).required(),
  
//   fees: Joi.array().items(
//     Joi.object({
//       student_id: Joi.string().hex().length(24).required(),
//       rollNumber: Joi.string().required(),
//       studentName: Joi.string().required(),
//       fatherName: Joi.string().allow('', null).optional(),
      
//       // ✅ Session ko fees array ke andar daal diya
//       session: Joi.string()
//         .pattern(/^\d{4}-\d{4}$/)
//         .optional()
//         .allow('', null),
        
//       due_amount_A: Joi.number().min(0).required(),
//       due_amount_B: Joi.number().min(0).required(),
//       status: Joi.string().valid('Active', 'Left College').required()
//     })
//   ).min(1).required()
// });

// const validateFeeData = (req, res, next) => {
//   const { error } = feeBulkSchema.validate(req.body);
  
//   if (error) {
//     let clientMessage = "⚠️ Validation Error: Please fill all fields in the grid correctly!";
//     const details = error.details[0];
    
//     if (details) {
//       if (details.path.includes('className')) clientMessage = "⚠️ Security Alert: Class Selection is mandatory!";
//       else if (details.path.includes('semA') || details.path.includes('semB')) clientMessage = "⚠️ Security Alert: Academic Semester parameters are missing!";
//       else if (details.path.includes('section')) clientMessage = "⚠️ Security Alert: Section allocation could not be verified!";
//       else if (details.path.includes('rollNumber')) clientMessage = "⚠️ Validation Alert: A student's Roll Number is missing or invalid!";
//       else if (details.path.includes('due_amount_A') || details.path.includes('due_amount_B')) clientMessage = "⚠️ Fee Alert: Due amounts cannot be empty (Enter 0 if no fees)!";
//       else if (details.path.includes('session')) clientMessage = "⚠️ Session Alert: Invalid Session format!";
//     }

//     req.flash("error", clientMessage);
    
//     const cName = req.body.className || '';
//     const sem = req.body.semA || '1';
//     const sec = req.body.section || '';
//     return res.redirect(`/add/student/fees?className=${encodeURIComponent(cName)}&semester=${sem}&section=${encodeURIComponent(sec)}`);
//   }
//   next();
// };

// module.exports = validateFeeData;




const Joi = require('joi');
const ExpressError = require("../utils/ExpressError");

// 🛡️ Tamper Proof Schema
const feeBulkSchema = Joi.object({
  className: Joi.string().required(),
  section: Joi.string().required(),
  semA: Joi.number().integer().min(1).max(8).required(),
  semB: Joi.number().integer().min(1).max(8).required(),
  
  // ⚡ New Fields Added Here (Prevents Unknown Field Validation Errors)
  mode: Joi.string().valid('create', 'edit').optional().allow('', null),
  batchSession: Joi.string().optional().allow('', null),
  
  fees: Joi.array().items(
    Joi.object({
      student_id: Joi.string().hex().length(24).required(),
      rollNumber: Joi.string().required(),
      studentName: Joi.string().required(),
      fatherName: Joi.string().allow('', null).optional(),
      
      // ✅ Session Pattern (Flexible for 2024-2027 or 2024-2028)
      session: Joi.string()
        .pattern(/^\d{4}-\d{4}$/)
        .optional()
        .allow('', null),
        
      due_amount_A: Joi.number().min(0).required(),
      due_amount_B: Joi.number().min(0).required(),
      status: Joi.string().valid('Active', 'Left College').required()
    })
  ).min(1).required()
}).unknown(true); // 👈 Allows additional query metadata without crashing

const validateFeeData = (req, res, next) => {
  const { error } = feeBulkSchema.validate(req.body);
  
  if (error) {
    let clientMessage = "⚠️ Validation Error: Please fill all fields in the grid correctly!";
    const details = error.details[0];
    
    // Console log to debug exact field failure in development
    console.error("❌ Joi Validation Failed At:", details);

    if (details) {
      if (details.path.includes('className')) clientMessage = "⚠️ Security Alert: Class Selection is mandatory!";
      else if (details.path.includes('semA') || details.path.includes('semB')) clientMessage = "⚠️ Security Alert: Academic Semester parameters are missing!";
      else if (details.path.includes('section')) clientMessage = "⚠️ Security Alert: Section allocation could not be verified!";
      else if (details.path.includes('rollNumber')) clientMessage = "⚠️ Validation Alert: A student's Roll Number is missing or invalid!";
      else if (details.path.includes('due_amount_A') || details.path.includes('due_amount_B')) clientMessage = "⚠️ Fee Alert: Due amounts cannot be empty (Enter 0 if no fees)!";
      else if (details.path.includes('session')) clientMessage = "⚠️ Session Alert: Invalid Session format!";
    }

    req.flash("error", clientMessage);
    
    const cName = req.body.className || '';
    const sem = req.body.semA || '1';
    const sec = req.body.section || '';
    const mode = req.body.mode || 'create';
    
    return res.redirect(`/add/student/fees?className=${encodeURIComponent(cName)}&semester=${sem}&section=${encodeURIComponent(sec)}&mode=${mode}`);
  }
  next();
};

module.exports = validateFeeData;