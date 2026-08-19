// const cloudinary = require('cloudinary').v2
// const{ CloudinaryStorage }=require("multer-storage-cloudinary");
// cloudinary.config({
//     cloud_name:process.env.CLOUD_NAME,
//     api_key:process.env.CLOUD_API_KEY,
//     api_secret:process.env.CLOUD_API_SECRET,
// })

// const storage = new CloudinaryStorage({
//   cloudinary: cloudinary,
//   params: {
//     folder: 'MajorProject_files',
//     allowerdFormats:["png", "jpg", "jpeg"],
//     // public_id: (req, file) => 'computed-filename-using-request',
//   },
// });

// module.exports={
//     cloudinary,
//     storage
// }

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Check file type to automatically handle documents and images
    const isImage = file.mimetype.startsWith("image/");
    
    return {
      folder: 'MajorProject_files',
      // Images ke liye 'image', baaki PDF/Word/Excel ke liye 'raw'
      resource_type: isImage ? 'image' : 'raw', 
      // Allowed formats (Fixed spelling from allowerdFormats -> allowedFormats)
      allowedFormats: ['png', 'jpg', 'jpeg', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
      public_id: Date.now() + '-' + file.originalname.replace(/\s+/g, '_')
    };
  },
});

module.exports = {
  cloudinary,
  storage
};
