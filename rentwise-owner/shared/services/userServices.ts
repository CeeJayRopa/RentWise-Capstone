import { doc, getDoc } from "firebase/firestore";
import { db } from "./firestore";


export const getUserRole = async (
  uid:string
) => {

  const userRef = doc(
    db,
    "users",
    uid
  );


  const userSnap = await getDoc(userRef);


  if(userSnap.exists()){

    return userSnap.data().role;

  }


  return null;

};