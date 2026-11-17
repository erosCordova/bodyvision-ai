import { useEffect, useRef, type PropsWithChildren } from "react";
export function Modal({
  title,
  onClose,
  children,
}: PropsWithChildren<{ title: string; onClose: () => void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="data-modal"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar diálogo">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
