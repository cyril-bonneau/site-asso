import React, { useState } from "react";
import "./App.css";

const handleListUsers = async () => {
    try {
        const response = await fetch("http://localhost:5000/users", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });
    } catch (err) {
        console.error(err)
        alert("Error fetching users")
    }
}

module.exports = handleListUsers;