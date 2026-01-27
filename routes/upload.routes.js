const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: "uploads/productos",
  filename: (_, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

module.exports = multer({ storage });
