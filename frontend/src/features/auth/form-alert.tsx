/**
 * Région d'alerte d'un formulaire : toujours présente dans le DOM (sinon les lecteurs d'écran
 * n'annoncent pas toujours le premier message), visible seulement quand elle a un contenu.
 */
export function FormAlert({ messages }: { messages: string[] }) {
  return (
    <div role="alert" className="empty:hidden">
      {messages.length > 0 && (
        <div className="rounded-control border-danger text-danger border p-4 font-semibold">
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
