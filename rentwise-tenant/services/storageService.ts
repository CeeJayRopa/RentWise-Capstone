// services/storageService.ts

import { CLOUDINARY_NAME, CLOUDINARY_PRESET } from "../shared/cloudinary";

export async function uploadReceiptImage(base64Data: string): Promise<string> {
  try {
    const formData = new FormData();

    // Convert base64 image to Cloudinary upload format
    formData.append("file", `data:image/jpeg;base64,${base64Data}`);

    formData.append("upload_preset", CLOUDINARY_PRESET);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_NAME}/image/upload`;

    const response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Cloudinary upload failed");
    }

    if (!data.secure_url) {
      throw new Error("No image URL returned from Cloudinary");
    }

    return data.secure_url;
  } catch (error: any) {
    console.log("Cloudinary Upload Error:", error.message);

    throw error;
  }
}
