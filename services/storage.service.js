const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET
});

function uploadImage(buffer, storageKey) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: storageKey,
        overwrite: true,
        resource_type: "image"
      },
      (err, result) => {
        if (err) return reject(err);

        resolve({
          storage_key: result.public_id,
          storage_provider: "cloudinary",
          url: result.secure_url
        });
      }
    );

    stream.end(buffer);
  });
}

module.exports = { uploadImage };
