import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it,vi} from "vitest";
const record=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/telemetry/client",()=>({recordClientBoundaryError:record}));
import {PredictionErrorBoundary} from "@/components/predictions/PredictionErrorBoundary";
it("reports render failures through the privacy owner, hides raw text and allows explicit retry",async()=>{
  const user=userEvent.setup();let fail=true;const error=new Error("private payload must remain hidden");
  function Content(){if(fail)throw error;return <p>预测已恢复</p>;}
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  try{
    render(<PredictionErrorBoundary><Content/></PredictionErrorBoundary>);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText(error.message)).toBeNull();
    expect(record).toHaveBeenCalledWith(error);
    fail=false;await user.click(screen.getByRole("button",{name:"重试预测"}));
    expect(screen.getByText("预测已恢复")).toBeVisible();
  }finally{log.mockRestore();}
});
