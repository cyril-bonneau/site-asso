import React, { useState } from "react";
import { NavLink, Link } from "react-router-dom";
import "../style/Header.css";

export default function Header() {
    const [open, setOpen] = useState(false);

    const routes = [
        { to: "/", label: "Accueil", end: true },
        { to: "/signup", label: "Inscription" },
    ];

    const closeMenu = () => setOpen(false);

    return (
        <header className="site-header">
            <a href="#main" className="skip-link">Aller au contenu</a>

            <div className="header-inner">
                <div className="brand">
                    <Link to="/" onClick={closeMenu}>
                        <span className="logo">⚡</span>
                        <span className="brand-text">MyApp</span>
                    </Link>
                </div>

                <button
                    className="nav-toggle"
                    aria-label="Ouvrir/fermer la navigation"
                    aria-expanded={open}
                    aria-controls="primary-navigation"
                    onClick={() => setOpen((v) => !v)}
                >
                    <span className="bar" />
                    <span className="bar" />
                    <span className="bar" />
                </button>

                <nav
                    id="primary-navigation"
                    className={`nav ${open ? "open" : ""}`}
                    onClick={(e) => {
                        if (e.target.tagName === "A") closeMenu();
                    }}
                >
                    <ul>
                        {routes.map((r) => (
                            <li key={r.to}>
                                <NavLink
                                    to={r.to}
                                    end={r.end}
                                    className={({ isActive }) =>
                                        "nav-link" + (isActive ? " active" : "")
                                    }
                                >
                                    {r.label}
                                </NavLink>
                            </li>
                        ))}
                    </ul>

                    {/* CTA optionnel (garde-le ou supprime-le) */}
                    <div className="cta">
                        <NavLink to="/signup" className="btn-cta">
                            Créer un compte
                        </NavLink>
                    </div>
                </nav>
            </div>
        </header>
    );
}
