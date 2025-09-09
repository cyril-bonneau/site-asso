import React, { useState } from "react";
import "../style/Signup.css";

function SignUp() {

    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");

    const handleEmail = (e) => {
        setEmail(e.target.value);
    }

    const handleName = (e) => {
        setName(e.target.value);
    }

    const handlePhone = (e) => {
        setPhone(e.target.value);
    }

    const handlePassword = (e) => {
        setPassword(e.target.value);
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!email || !name || !phone || !password) {
            return alert("Please fill all the fields")
        } else {
            const userData = {
                email: email,
                name: name,
                phone: phone,
                password: password
            }
            try {
                const add = await fetch("http://localhost:5000/register", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(userData),
                });
                const data = await add.json();
                if (add.ok) {
                    alert("User added successfully");
                    console.log(add)
                }
                else if (add.status === 400 && data.error === "Email_already_exists") {
                    alert("Email already exists");
                    throw new Error("Failed to add user");
                }
            } catch (err) {
                console.error(err)
            }
        }
    }

    return (
        <div className="Heading">
            <h1>Inscription</h1>
            <div className="App">
                <form onSubmit={handleSubmit}>
                    <label>Email</label>
                    <input
                        placeholder="Enter Email"
                        type="email"
                        onChange={handleEmail}
                    />
                    <label>Name</label>
                    <input
                        placeholder="Enter Name"
                        type="text"
                        onChange={handleName}
                    />
                    <label>Phone Number</label>
                    <input
                        placeholder="Enter Phone Number"
                        type="tel"
                        onChange={handlePhone}
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