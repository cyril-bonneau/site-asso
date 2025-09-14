import React, { useState } from "react";
import "../style/Signup.css";

function SignUp() {

    const [email, setEmail] = useState("j@j.j");
    const [password, setPassword] = useState("azerty123456789");

    const handleEmail = (e) => {
        setEmail(e.target.value);
    }

    const handlePassword = (e) => {
        setPassword(e.target.value);
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!email || !password) {
            return alert("Please fill all the fields")
        } else {
            const userData = {
                email: email,
                password: password
            }
            try {
                const checkin = await fetch("http://localhost:5000/signin", {
                    method: "post",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify(userData),
                });
                if (checkin.ok) {
                    alert("you are signed in");
                    console.log(checkin)
                }
                else if (checkin.status === 401) {
                    alert("Invalid email or password");
                    throw new Error("Failed to connect user");
                }
            } catch (err) {
                console.error(err)
            }
        }
    }

    return (
        <div className="Heading">
            <h1>Connexion</h1>
            <div className="App">
                <form onSubmit={handleSubmit}>
                    <label>Email</label>
                    <input
                        placeholder="Enter Email"
                        type="email"
                        onChange={handleEmail}
                    />
                    <label>Password</label>
                    <input
                        placeholder=" Enter Password"
                        type="password"
                        onChange={handlePassword}
                    />
                    <button type="submit" className="btn">
                        Submit
                    </button>
                </form>
            </div>
        </div>
    );
}

export default SignUp;