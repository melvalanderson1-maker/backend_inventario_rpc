function resolveImageUrl(image) {
  if (!image) return null;

  switch (image.storage_provider) {
    case "cloudinary":
      return `https://res.cloudinary.com/${process.env.CLOUDINARY_NAME}/image/upload/${image.storage_key}.jpg`;

    case "s3":
      return `https://${process.env.AWS_BUCKET}.s3.amazonaws.com/${image.storage_key}`;

    default:
      return null;
  }
}

module.exports = { resolveImageUrl };
