"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  Search,
  ShoppingCart,
  Gauge,
  BarChart3,
  MapPinned,
  Shirt,
  Tags,
  Layers3,
  ReceiptText,
  Users,
  Settings,
  LogOut
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser"; // 👈 import do supabase client

const ACCENT = "#01A920";

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dasboard", icon: <Gauge className="w-4 h-4" /> },
  { label: "Produtos", href: "/dasboard/produtos", icon: <Shirt className="w-4 h-4" /> },
  { label: "Categorias", href: "/dasboard/categorias", icon: <Tags className="w-4 h-4" /> },
  { label: "Variantes", href: "/dasboard/variantes", icon: <Layers3 className="w-4 h-4" /> },
  { label: "Pedidos", href: "/dasboard/pedidos", icon: <ReceiptText className="w-4 h-4" /> },
  { label: "Relatório", href: "/dasboard/relatorio", icon: <BarChart3 className="w-4 h-4" /> },
  { label: "Clientes", href: "/dasboard/clientes", icon: <Users className="w-4 h-4" /> },
  { label: "Trackeamento", href: "/dasboard/trackeamento", icon: <MapPinned className="w-4 h-4" /> }, 
  { label: "Configuração", href: "/dasboard/config", icon: <Settings className="w-4 h-4" /> },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const supabase = supabaseBrowser();

  React.useEffect(() => {
    setOpen(false); // fecha o menu ao mudar de rota
  }, [pathname]);

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } finally {
      // middleware vai bloquear /dasboard* e mandar pro /login mesmo que o cookie ainda esteja atualizando
      window.location.href = "/login";
    }
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Topbar da área logada */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-100">
        <div className="mx-auto max-w-screen-lg px-3 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label="Abrir menu"
              className="p-2 rounded-xl border border-gray-200 bg-white shadow-sm active:scale-[0.98]"
              type="button"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-base font-semibold tracking-tight">Painel Lucena Modas</div>
          </div>

          <div className="flex items-center gap-2">
            <button className="p-2 rounded-xl border border-gray-200 bg-white shadow-sm" type="button">
              <Search className="w-5 h-5" />
            </button>
            <button className="p-2 rounded-xl border border-gray-200 bg-white shadow-sm" type="button">
              <ShoppingCart className="w-5 h-5" />
            </button>
            <button
              className="p-2 rounded-xl border border-gray-200 bg-white shadow-sm"
              onClick={handleLogout}
              title="Sair"
              type="button"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-screen-lg grid grid-cols-1 md:grid-cols-[240px_1fr]">
        {/* Sidebar (mobile drawer + desktop fixa) */}
        <aside className="relative">
          {/* Backdrop mobile */}
          {open && (
            <button
              aria-label="Fechar menu"
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm md:hidden"
              type="button"
            />
          )}

          <nav
            className={`fixed md:static inset-y-0 left-0 w-[80%] max-w-[280px] md:w-auto md:max-w-none bg-white md:bg-transparent border-r md:border-r-0 border-gray-100 z-50 transform transition-transform duration-200 ease-out ${
              open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
            }`}
          >
            <div className="h-14 md:hidden" />
            <div className="p-3 md:pt-6 md:pl-3 md:pr-2">
              <ul className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`group flex items-center gap-3 rounded-xl border text-sm px-3 py-2 transition ${
                          active
                            ? "bg-white border-[1.5px]"
                            : "bg-gray-50 border-gray-100 hover:bg-white"
                        }`}
                        style={active ? { borderColor: ACCENT } : {}}
                      >
                        <span
                          className="grid place-items-center w-6 h-6 rounded-md"
                          style={active ? { backgroundColor: ACCENT } : { backgroundColor: "#F3F4F6" }}
                        >
                          <span className={active ? "text-white" : "text-gray-700"}>{item.icon}</span>
                        </span>
                        <span className={`truncate ${active ? "font-semibold" : "text-gray-700"}`}>
                          {item.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>
        </aside>

        {/* Conteúdo */}
        <section className="px-3 md:px-6 py-4 md:py-6">
          {children}
        </section>
      </div>
    </div>
  );
}
