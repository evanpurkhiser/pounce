import {useState} from 'react';

import {toast} from 'sonner';

import {OAuthConfigurationError, startOAuth} from '../data/lunchMoneyOAuth';
import ui from '../ui/ui.module.css';

export function LunchMoneyConnection({
  budgetName,
  disconnect,
}: {
  budgetName?: string;
  disconnect: () => void;
}) {
  const [redirecting, setRedirecting] = useState(false);

  async function authorize() {
    setRedirecting(true);
    try {
      await startOAuth();
    } catch (error) {
      toast.error(
        error instanceof OAuthConfigurationError
          ? error.message
          : 'Could not start the Lunch Money authorization. Try again.',
      );
      setRedirecting(false);
    }
  }

  if (budgetName) {
    return (
      <div className={ui.editor}>
        <p>Connected to {budgetName}.</p>
        <div className={ui.controls}>
          <button type="button" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={ui.controls}>
      <button type="button" disabled={redirecting} onClick={authorize}>
        {redirecting ? 'Opening Lunch Money…' : 'Authorize with Lunch Money'}
      </button>
    </div>
  );
}
