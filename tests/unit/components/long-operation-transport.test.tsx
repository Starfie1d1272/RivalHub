import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({recording:vi.fn(),respond:vi.fn()}));
vi.mock("@/actions/postmatch",()=>({mutateMatchRecording:mocks.recording}));
vi.mock("@/actions/matches/scheduling",()=>({respondToTimeProposal:mocks.respond,proposeMatchTime:vi.fn(),forceSetMatchTime:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/lib/telemetry/client",()=>({observeAction:(_name:string,action:unknown)=>action}));
vi.mock("sonner",()=>({toast:{error:vi.fn(),success:vi.fn()}}));
import { MatchRecordingEditor } from "@/components/matches/MatchRecordingEditor";
import { MatchTimeNegotiation } from "@/components/matches/MatchTimeNegotiation";
beforeEach(()=>vi.clearAllMocks());
it("does not repeat an unknown recording move",async()=>{
 mocks.recording.mockRejectedValue(new TypeError("lost response"));const user=userEvent.setup();
 render(<MatchRecordingEditor matchId="match" commentators={[{userId:"person",name:"Caster"}]} recordings={[
  {id:"a",commentatorUserId:"person",title:"Map A",url:"https://example.test/a"},
  {id:"b",commentatorUserId:"person",title:"Map B",url:"https://example.test/b"},
 ]}/>);
 const move=screen.getByRole("button",{name:"下移 Map A"});await user.click(move);
 expect(await screen.findByRole("alert")).toHaveTextContent("不要重复操作");expect(move).toBeDisabled();await user.click(move);expect(mocks.recording).toHaveBeenCalledOnce();
});
it("does not repeat an unknown proposal response",async()=>{
 mocks.respond.mockRejectedValue(new TypeError("lost response"));const user=userEvent.setup();
 render(<MatchTimeNegotiation matchId="match" isCaptainA isCaptainB={false} isAdmin={false} currentScheduledAt={null} currentCompletionDeadline={null} hasSubmittedRoster initialProposals={[
  {id:"proposal",status:"pending",proposedTime:new Date(Date.now()+3*60*60*1000),responseAt:null,rejectReason:null,createdAt:new Date(),isMine:false},
 ]}/>);
 const accept=screen.getByRole("button",{name:"接受"});await user.click(accept);
 expect(await screen.findByRole("alert")).toHaveTextContent("不要重复回应");expect(accept).toBeDisabled();await user.click(accept);expect(mocks.respond).toHaveBeenCalledOnce();
});
