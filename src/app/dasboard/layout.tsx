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
  LogOut,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser"; // 👈 supabase client

const ACCENT = "#01A920";

/** Navegação com suporte a submenu */
type NavItem = {
  label: string;
  icon: React.ReactNode;
  href?: string; // se tiver children, o href é opcional
  children?: { label: string; href: string }[];
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dasboard", icon: <Gauge className="w-4 h-4" /> },
  {
    label: "Produtos",
    icon: <Shirt className="w-4 h-4" />,
    // sem href aqui: o botão abre/fecha o submenu
    children: [
      { label: "Cadastrar Produto", href: "/dasboard/produtos" },        // 👈 mantém seu caminho atual
      { label: "Lista de Produtos", href: "/dasboard/produtos/lista" },  // 👈 ajuste a rota se precisar
    ],
  },
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
  const [open, setOpen] = React.useState(false); // drawer mobile
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const supabase = supabaseBrowser();

  // fecha o drawer ao mudar de rota
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // garante que o grupo "Produtos" fica aberto quando a rota atual é dele
  React.useEffect(() => {
    const shouldOpen: Record<string, boolean> = {};
    NAV_ITEMS.forEach((item) => {
      if (item.children?.length) {
        // abre automaticamente se a rota atual começa com a rota base do primeiro filho
        const base = item.children[0]?.href?.split("/").slice(0, 3).join("/") || "";
        if (base && pathname.startsWith(base)) {
          shouldOpen[item.label] = true;
        }
      }
    });
    setOpenGroups((prev) => ({ ...prev, ...shouldOpen }));
  }, [pathname]);

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } finally {
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
                  const hasChildren = !!item.children?.length;

                  // ativo do item simples
                  const isItemActive = !!item.href && pathname === item.href;

                  // ativo do grupo (se alguma rota filha casar)
                  const isGroupActive =
                    hasChildren && item.children!.some((c) => pathname === c.href || pathname.startsWith(c.href));

                  const active = isItemActive || isGroupActive;

                  const baseClasses =
                    "group flex items-center gap-3 rounded-xl border text-sm px-3 py-2 transition";
                  const normalClasses = active
                    ? "bg-white border-[1.5px]"
                    : "bg-gray-50 border-gray-100 hover:bg-white";

                  const iconBgStyle = active ? { backgroundColor: ACCENT } : { backgroundColor: "#F3F4F6" };
                  const iconTextClass = active ? "text-white" : "text-gray-700";
                  const textClass = `truncate ${active ? "font-semibold" : "text-gray-700"}`;

                  if (!hasChildren) {
                    // item simples (Link normal)
                    return (
                      <li key={item.label}>
                        <Link
                          href={item.href!}
                          className={`${baseClasses} ${normalClasses}`}
                          style={active ? { borderColor: ACCENT } : {}}
                          onClick={() => setOpen(false)}
                        >
                          <span className="grid place-items-center w-6 h-6 rounded-md" style={iconBgStyle}>
                            <span className={iconTextClass}>{item.icon}</span>
                          </span>
                          <span className={textClass}>{item.label}</span>
                        </Link>
                      </li>
                    );
                  }

                  // item com submenu
                  const isOpen = !!openGroups[item.label];

                  return (
                    <li key={item.label}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => toggleGroup(item.label)}
                        className={`${baseClasses} ${normalClasses} w-full text-left`}
                        style={active ? { borderColor: ACCENT } : {}}
                      >
                        <span className="grid place-items-center w-6 h-6 rounded-md" style={iconBgStyle}>
                          <span className={iconTextClass}>{item.icon}</span>
                        </span>
                        <span className={textClass} style={{ flex: 1 }}>
                          {item.label}
                        </span>
                        {isOpen ? (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-500" />
                        )}
                      </button>

                      {/* Submenu */}
                      <div
                        className={`grid overflow-hidden transition-all duration-200 ${
                          isOpen ? "grid-rows-[1fr] opacity-100 mt-1" : "grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div className="min-h-0">
                          <ul className="pl-9 pr-2 py-1 flex flex-col gap-1">
                            {item.children!.map((child) => {
                              const childActive = pathname === child.href;
                              return (
                                <li key={child.href}>
                                  <Link
                                    href={child.href}
                                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm border ${
                                      childActive
                                        ? "bg-white border-[1.5px] font-semibold"
                                        : "bg-gray-50 border-gray-100 hover:bg-white"
                                    }`}
                                    style={childActive ? { borderColor: ACCENT } : {}}
                                    onClick={() => setOpen(false)}
                                  >
                                    <span
                                      className="w-1.5 h-1.5 rounded-full"
                                      style={{ backgroundColor: childActive ? ACCENT : "#D1D5DB" }}
                                    />
                                    <span className={childActive ? "text-gray-900" : "text-gray-700"}>
                                      {child.label}
                                    </span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>
        </aside>

        {/* Conteúdo */}
        <section className="px-3 md:px-6 py-4 md:py-6">{children}</section>
      </div>
    </div>
  );
}
