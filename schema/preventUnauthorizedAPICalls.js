const ADMIN_PASSWORD = process.env.ADMIN_VERIFY_PASS || "admin123";
const API_SECRET_HEADER = process.env.API_SECRET_HEADER || "CollegeFeeSystemSecure#2026";

// Security Guard against Postman / Hoppscotch / Unauthorized API Calls
const preventUnauthorizedAPICalls = (req, res, next) => {
  // 1. Block direct browser/postman URL hits without Application Headers
  const clientHeader = req.headers['x-requested-with'] || req.headers['x-api-client-token'];
  
  if (!clientHeader || clientHeader !== API_SECRET_HEADER) {
    return res.status(403).json({ 
      success: false, 
      message: "🚨 Access Denied! Direct API calls via Postman/Hoppscotch are blocked." 
    });
  }

  // 2. Ensure User is Logged In (Assuming session-based auth)
  if (req.session && !req.session.user) {
    // Note: Adjust according to your session logic (e.g. req.isAuthenticated())
    // return res.status(401).json({ success: false, message: "Unauthorized! Please Login first." });
  }

  next();
};

module.exports = { preventUnauthorizedAPICalls, ADMIN_PASSWORD };