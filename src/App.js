import React from "react";
import {
  BrowserRouter, Routes, Route,

} from "react-router-dom";
import SignUp from "./views/SignUp";
import Header from "./components/Header";
import "./App.css";

function Home() {
  return <h1>Home</h1>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Header />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signup" element={<SignUp />} />
      </Routes>
    </BrowserRouter>
  );
}
