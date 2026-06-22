import { Timestamp } from "firebase/firestore";

export type User = {
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  contactNo: string;
  role: string;
  stallId: string;
  status: string;
  createdAt: Timestamp;
};
