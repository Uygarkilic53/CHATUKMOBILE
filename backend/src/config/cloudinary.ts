import dotenv from 'dotenv';
dotenv.config();

import { v2 as cloudinary } from 'cloudinary';

if (process.env.CLOUDINARY_URL) {
  try {
    const url = new URL(process.env.CLOUDINARY_URL);
    cloudinary.config({
      cloud_name: url.hostname,
      api_key: url.username,
      api_secret: url.password,
      secure: true,
      timeout: 180000,
    });
  } catch (err) {
    console.error('Failed to parse CLOUDINARY_URL:', err);
  }
}

export default cloudinary;
