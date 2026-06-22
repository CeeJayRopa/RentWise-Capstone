import { View, Text, TextInput, Button } from "react-native";
import { useState } from "react";
import { router } from "expo-router";

import { loginUser } from "../../shared/services/auth";
import { getUserRole } from "../../shared/services/userServices";


export default function Login(){

  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");


  const handleLogin = async()=>{

    try{

      const user = await loginUser(
        email,
        password
      );


      const role = await getUserRole(
        user.uid
      );


      console.log("ROLE:", role);


      if(role === "owner"){

        router.replace("/dashboard");

      }
      else{

        console.log("Access denied");

      }


    }
    catch(error){

      console.log(error);

    }

  };


  return(

    <View>

      <Text>
        Owner Login
      </Text>


      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
      />


      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />


      <Button
        title="Login"
        onPress={handleLogin}
      />


    </View>

  );

}