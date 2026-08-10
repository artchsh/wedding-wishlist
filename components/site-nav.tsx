"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/", label: "Подарки" },
  { href: "/rsvp", label: "Приду / не приду" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
      {NAV_ITEMS.map((item) => (
        <Button
          key={item.href}
          asChild
          size="lg"
          variant={pathname === item.href ? "default" : "ghost"}
        >
          <Link
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            {item.label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
