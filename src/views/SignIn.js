import React, { useState } from "react";
import "../style/Signup.css";

function SignUp() {

    const [email, setEmail] = useState("b@b.b");
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
                const checkin = await fetch("/api/login", {
                    method: "post",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(userData),
                });
                const data = await checkin.json();
                if (checkin.ok) {
                    alert("you are signed in");
                    console.log(data)
                    console.log(data.accessToken)
                    console.log(data.refreshToken)
                }
                else if (checkin.status === 401) {
                    alert("Invalid email or password");
                    throw new Error("Failed to connect user");
                } else if (checkin.status === 500) {
                    alert("Server error. Please try again later.");
                    throw new Error("Server error");
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