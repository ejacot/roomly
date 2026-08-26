import type { OrganizationMember, StaffingDayEntry, StaffingRequirement } from "../../types/business";
export type PrintLanguage = "ro" | "en" | "de" | "ru";
export function openBusinessSchedulePrint() { window.setTimeout(() => window.print(), 50); }
const copy = {
  ro:{title:"Program săptămânal",employee:"Angajat",rest:"Liber",vacation:"Concediu",sick:"Medical",generated:"Generat cu Alveryn"},
  en:{title:"Weekly schedule",employee:"Employee",rest:"Day off",vacation:"Vacation",sick:"Sick",generated:"Generated with Alveryn"},
  de:{title:"Wöchentlicher Dienstplan",employee:"Mitarbeiter",rest:"Frei",vacation:"Urlaub",sick:"Krank",generated:"Erstellt mit Alveryn"},
  ru:{title:"Недельный график",employee:"Сотрудник",rest:"Выходной",vacation:"Отпуск",sick:"Больничный",generated:"Создано в Alveryn"}
};
export function BusinessSchedulePrint({organizationName,from,to,language,days,members,requirements,dayEntries}:{organizationName:string;from:string;to:string;language:PrintLanguage;days:string[];members:OrganizationMember[];requirements:StaffingRequirement[];dayEntries:StaffingDayEntry[]}) {
  const text=copy[language];
  return <section className="business-print-root" aria-label={text.title}><header><div><h1>{organizationName}</h1><p>{text.title} · {from} — {to}</p></div><strong>ALVERYN</strong></header><table><thead><tr><th>{text.employee}</th>{days.map(day=><th key={day}>{new Date(`${day}T12:00:00`).toLocaleDateString(language,{weekday:"short",day:"2-digit",month:"2-digit"})}</th>)}</tr></thead><tbody>{members.map(member=><tr key={member.id}><th>{memberName(member)}</th>{days.map(day=>{const entry=dayEntries.find(value=>value.membershipId===member.id&&value.date===day);const assigned=requirements.filter(value=>value.date===day).flatMap(requirement=>requirement.assignments.filter(assignment=>assignment.membershipId===member.id).map(assignment=>({requirement,assignment})));return <td key={day}>{entry?<span className="business-print-day-type">{entry.type==="REST_DAY"?text.rest:entry.type==="VACATION"?text.vacation:text.sick}</span>:null}{assigned.map(({requirement,assignment})=><div className="business-print-shift" key={assignment.id} style={{borderLeftColor:requirement.color}}><b>{requirement.workTypeName}</b><small>{time(assignment.startTime??requirement.startTime,assignment.endTime??requirement.endTime)} · {requirement.unitName}</small></div>)}</td>})}</tr>)}</tbody></table><footer>{text.generated} · {new Date().toLocaleDateString(language)}</footer></section>;
}
function memberName(member:OrganizationMember){return [member.firstName,member.lastName].filter(Boolean).join(" ")||member.email||"—";}
function time(start:string|null,end:string|null){return start?`${start.slice(0,5)}${end?`–${end.slice(0,5)}`:""}`:"—";}
